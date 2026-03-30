const { STRATEGIES, DATA_VERSION } = require("./constants/climatiq_catalog");
const { entenderFacturaParaClimatiq } = require("./bedrock");

const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const BASE_URL = "https://api.climatiq.io/data/v1";

function buildClimatiqParameters(strategy, line) {
    const unit = line.unit?.toLowerCase() || strategy.default_unit;
    switch (strategy.unit_type) {
        case "energy": return { energy: Number(line.value), energy_unit: unit };
        case "weight": return { weight: Number(line.value), weight_unit: unit };
        case "distance": return { distance: Number(line.value), distance_unit: unit };
        default: return null;
    }
}

async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    try {
        const fullAnalysis = await entenderFacturaParaClimatiq(ocrSummary, queryHints);
        
        // 1. Blindaje de entrada: Si la IA falla, retornamos estructura vacía segura
        const lines = fullAnalysis?.emission_lines || [];
        const meta = fullAnalysis?.extracted_data || {};

        if (lines.length === 0) return null;

        const linePromises = lines.map(async (line) => {
            const strategy = STRATEGIES[line.strategy];
            if (!strategy) return { success: false, error: "No Strategy", desc: line.description };

            try {
                const res = await fetch(`${BASE_URL}/estimate`, {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${CLIMATIQ_API_KEY}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({
                        data_version: "32.32",
                        emission_factor: { activity_id: strategy.activity_id },
                        parameters: buildClimatiqParameters(strategy, line)
                    })
                });

                const data = await res.json();
                
                // 2. Log de seguridad para ver qué responde Climatiq realmente
                if (!res.ok) {
                    console.error(`❌ [CLIMATIQ_API_REJECTED]: ${data.message}`);
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

        // 3. PROTECCIÓN FINAL DEL REDUCE:
        // Filtramos para asegurar que el objeto tenga la propiedad 'co2e' y sea exitoso
        const successfulOnes = results.filter(r => r && r.success && typeof r.co2e === 'number');

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