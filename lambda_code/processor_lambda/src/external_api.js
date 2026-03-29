const { generarBusquedaSemantica, extraerValorEspecifico } = require("./bedrock");

const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "32.32";
const BASE_URL = "https://api.climatiq.io/data/v1";

/**
 * Orquestación dinámica: 
 * 1. Bedrock propone términos. 
 * 2. Climatiq Search valida el factor. 
 * 3. Bedrock extrae la unidad requerida.
 */
async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    console.log("---------- [SEMANTIC CLIMATIQ FLOW] ----------");

    try {
        // --- PASO 1: BÚSQUEDA ---
        const preAnalysis = await generarBusquedaSemantica(ocrSummary, queryHints);
        console.log(`🔎 Intent: ${preAnalysis.search_query} (${preAnalysis.vendor})`);

        const searchRes = await fetch(`${BASE_URL}/search?query=${encodeURIComponent(preAnalysis.search_query)}&limit=1`, {
            headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
        });
        const searchData = await searchRes.json();

        if (!searchData.results?.length) {
            throw new Error(`No factors found for: ${preAnalysis.search_query}`);
        }

        const factor = searchData.results[0];
        console.log(`✅ Match: ${factor.activity_id} | Needs: ${factor.unit_type}`);

        // --- PASO 2: EXTRACCIÓN DIRIGIDA ---
        // Le pasamos el 'unit_type' real de la API a Bedrock
        const extraction = await extraerValorEspecifico(ocrSummary, factor.unit_type);

        // --- PASO 3: CONSTRUCCIÓN DINÁMICA ---
        const payload = {
            data_version: DATA_VERSION,
            emission_factor: {
                activity_id: factor.activity_id,
                region: preAnalysis.region || factor.allowed_regions[0] || "WORLD"
            },
            parameters: {
                [extraction.key]: Number(extraction.value),
                [`${extraction.key}_unit`]: extraction.unit
            }
        };

        // Manejo de moneda para cálculos basados en gasto
        if (factor.unit_type === 'money') {
            payload.parameters.currency = extraction.currency || "EUR";
        }

        console.log("🚀 [PAYLOAD]:", JSON.stringify(payload, null, 2));

        // --- PASO 4: ESTIMACIÓN ---
        const res = await fetch(`${BASE_URL}/estimate`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${CLIMATIQ_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Estimation Failed");

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            activity_id: factor.activity_id,
            vendor: preAnalysis.vendor,
            audit: "semantic_search_v2"
        };

    } catch (err) {
        console.error("❌ [CLIMATIQ_PIPELINE_ERROR]:", err.message);
        return null; 
    }
}

module.exports = { calculateInClimatiq };