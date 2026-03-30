// external_api.js
const { entenderFacturaParaClimatiq } = require("./bedrock"); // <--- ESTA ES LA CLAVE
const { STRATEGIES, DATA_VERSION } = require("./constants/climatiq_catalog");

/** * Esta función es el "Mapper" que limpia el loop principal.
 * Convierte lo que la IA entendió en lo que la API de Climatiq exige.
 */
function buildClimatiqParameters(strategy, line) {
    const unit = line.unit?.toLowerCase() || strategy.default_unit;
    
    switch (strategy.unit_type) {
        case "energy":
            return { energy: line.value, energy_unit: unit };
        
        case "weightoverdistance":
            return {
                weight: line.logistics_meta?.weight || line.value,
                weight_unit: "t",
                distance: line.logistics_meta?.distance || 0,
                distance_unit: "km"
            };
        
        case "distance":
            return { 
                distance: line.logistics_meta?.distance || line.value, 
                distance_unit: unit 
            };
        
        case "weight":
            return { weight: line.value, weight_unit: unit };
            
        default:
            return null;
    }
}

exports.calculateInClimatiq = async function(ocrSummary, queryHints = {}) {
    try {
        const fullAnalysis = await entenderFacturaParaClimatiq(ocrSummary, queryHints);
        const { emission_lines, extracted_data } = fullAnalysis;

        // --- AQUÍ ESTÁ EL LOOP ---
        // Transformamos cada línea de la IA en una petición a Climatiq
        const linePromises = emission_lines.map(async (line) => {
            const strategy = STRATEGIES[line.strategy];
            if (!strategy) return { error: `Strategy ${line.strategy} not found`, desc: line.description };

            const parameters = buildClimatiqParameters(strategy, line);

            const res = await fetch(`${BASE_URL}/estimate`, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${CLIMATIQ_API_KEY}`, 
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify({
                    data_version: DATA_VERSION || "^1",
                    emission_factor: { activity_id: strategy.activity_id, region: line.region || "GB" },
                    parameters
                })
            });

            const data = await res.json();
            if (!res.ok) return { error: data.message, desc: line.description };

            return {
                success: true,
                co2e: data.co2e,
                unit: data.co2e_unit,
                strategy: line.strategy,
                description: line.description
            };
        });

        // Esperamos a que todas las líneas terminen (en paralelo)
        const results = await Promise.all(linePromises);

        // Filtramos solo las que tuvieron éxito para el total
        const successfulOnes = results.filter(r => r.success);

        return {
            total_co2e: successfulOnes.reduce((acc, curr) => acc + curr.co2e, 0),
            items: results, // Devolvemos todo (éxitos y fallos) para que el usuario lo vea
            invoice_metadata: extracted_data // Vendor, TAX ID, Invoice No, etc.
        };

    } catch (err) {
        console.error("❌ [FATAL_LOOP_ERROR]:", err.message);
        return null;
    }
}
