const { STRATEGIES } = require("./constants/climatiq_catalog");
const { entenderFacturaParaClimatiq } = require("./bedrock");

// Te recomiendo mover la Key a Environment Variables en AWS, 
// pero para el fix la mantenemos aquí.
const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const BASE_URL = "https://api.climatiq.io/data/v1";

function buildClimatiqParameters(strategy, line) {
    const val = Number(line.value) || 0;
    const unit = (line.unit || strategy.default_unit || "").toLowerCase();
    
    switch (strategy.unit_type) {
        case "energy": return { energy: val, energy_unit: unit };
        case "weight": return { weight: val, weight_unit: unit };
        case "distance": return { distance: val, distance_unit: unit };
        default: return null;
    }
}

async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    try {
        const fullAnalysis = await entenderFacturaParaClimatiq(ocrSummary, queryHints);
        const lines = fullAnalysis?.emission_lines || [];
        const meta = fullAnalysis?.extracted_data || {};

        if (lines.length === 0) return null;

        const linePromises = lines.map(async (line) => {
            const strategy = STRATEGIES[line.strategy];
            if (!strategy) return { success: false, error: "No Strategy", desc: line.description };

            const params = buildClimatiqParameters(strategy, line);

            try {
                // CLIMATIQ ESTRUCTURA 32.32 ESTRICTA:
                const requestBody = {
                    data_version: "32.32", // OBLIGATORIO AL INICIO
                    emission_factor: {
                        activity_id: strategy.activity_id
                        // Nota: NO incluimos 'region' ni 'year' aquí si usamos activity_id genéricos
                    },
                    parameters: params
                };

                const urlWithVersion = `${BASE_URL}/estimate?data_version=32.32`;

                const res = await fetch(urlWithVersion, {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${CLIMATIQ_API_KEY}`, 
                        "Content-Type": "application/json",
                        "Accept": "application/json" // Aseguramos negociación de contenido
                    },
                    body: JSON.stringify({
                        ...requestBody,
                        data_version: "32.32" // Reforzamos dentro del JSON también
                    })
                });

                const data = await res.json();
                
                if (!res.ok) {
                    // Si el error es de versión otra vez, Climatiq nos está pidiendo 
                    // que el factor de emisión sea mapeado de forma diferente
                    console.error(`❌ [CLIMATIQ_REJECTED]: ${data.message}`);
                    return { success: false, error: data.message, desc: line.description };
                }

                return {
                    success: true,
                    co2e: data.co2e || 0,
                    unit: data.co2e_unit,
                    strategy: line.strategy,
                    description: line.description
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        const results = await Promise.all(linePromises);
        const successfulOnes = (results || []).filter(r => r && r.success && typeof r.co2e === 'number');

        return {
            total_co2e: successfulOnes.reduce((acc, curr) => acc + curr.co2e, 0),
            items: results, 
            invoice_metadata: {
                vendor: meta.vendor?.name || "Unknown",
                invoice_no: meta.invoice_number || "N/A",
                invoice_date: meta.invoice_date || new Date().toISOString(),
                total_amount_net: meta.total_amount_net || 0,
                currency: meta.currency || "EUR"
            }
        };

    } catch (err) {
        console.error("❌ [FATAL_LOOP_ERROR]:", err.message);
        return null;
    }
}

module.exports = { calculateInClimatiq };