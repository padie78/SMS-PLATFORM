const { generarBusquedaSemantica, extraerValorEspecifico } = require("./bedrock");

const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "32.32";
const BASE_URL = "https://api.climatiq.io/data/v1";

/**
 * Orquestación dinámica con Trazabilidad Completa (Logs v2)
 */
async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    const startTime = Date.now();
    console.log("---------- [SEMANTIC CLIMATIQ FLOW START] ----------");

    try {
        // --- PASO 1: ANÁLISIS INICIAL CON BEDROCK ---
        console.log("[CLIMATIQ_STEP 1]: Invoking Bedrock for semantic mapping...");
        const preAnalysis = await generarBusquedaSemantica(ocrSummary, queryHints);
        const region = preAnalysis.region || "ES";
        
        console.log(`[INFO] Intent: "${preAnalysis.search_query}" | Vendor: ${preAnalysis.vendor} | Service: ${preAnalysis.service_type} | Region: ${region}`);

        // --- PASO 2: BÚSQUEDA Y FALLBACK ---
        console.log(`[CLIMATIQ_STEP 2]: Searching emission factor for "${preAnalysis.search_query}"...`);
        let searchData = await callClimatiqSearch(preAnalysis.search_query, region);
        let usedFallback = false;

        if (!searchData.results?.length) {
            console.warn(`[WARN] No direct match found for "${preAnalysis.search_query}".`);
            
            const fallbackMap = { 'elec': 'electricity', 'gas': 'natural gas', 'fuel': 'diesel' };
            const genericQuery = fallbackMap[preAnalysis.service_type] || preAnalysis.service_type;
            
            console.log(`[INFO] Triggering Fallback Search: Using generic "${genericQuery}" in ${region}`);
            searchData = await callClimatiqSearch(genericQuery, region);
            usedFallback = true;
        }

        if (!searchData.results?.length) {
            console.error(`[ERROR] Critical: No factors found in Climatiq DB for Service: ${preAnalysis.service_type} / Region: ${region}`);
            throw new Error(`Total Failure: No emission factors found even with fallback.`);
        }

        const factor = searchData.results[0];
        console.log(`[INFO] Factor Selected: ${factor.activity_id} (Unit Type: ${factor.unit_type})`);

        // --- PASO 3: EXTRACCIÓN DE VALORES ---
        console.log(`[CLIMATIQ_STEP 3]: Bedrock extraction for Unit Type "${factor.unit_type}"...`);
        const extraction = await extraerValorEspecifico(ocrSummary, factor.unit_type);
        console.log(`[INFO] Extracted: ${extraction.value} ${extraction.unit} (Key: ${extraction.key})`);

        // --- PASO 4: CONSTRUCCIÓN DEL PAYLOAD ---
        const payload = {
            data_version: DATA_VERSION,
            emission_factor: {
                activity_id: factor.activity_id,
                region: region
            },
            parameters: {
                [extraction.key]: Number(extraction.value),
                [`${extraction.key}_unit`]: extraction.unit
            }
        };

        if (factor.unit_type === 'money') {
            payload.parameters.currency = extraction.currency || "EUR";
        }

        console.log("🚀 [CLIMATIQ_ESTIMATE_PAYLOAD]:", JSON.stringify(payload, null, 2));

        // --- PASO 5: CÁLCULO FINAL ---
        console.log("[CLIMATIQ_STEP 5]: Requesting estimate from Climatiq...");
        const res = await fetch(`${BASE_URL}/estimate`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${CLIMATIQ_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if (!res.ok) {
            console.error("❌ [CLIMATIQ_ESTIMATE_ERROR]:", JSON.stringify(data, null, 2));
            throw new Error(data.message || "Estimation Failed");
        }

        const duration = Date.now() - startTime;
        console.log(`✅ [CLIMATIQ_SUCCESS]: ${data.co2e} ${data.co2e_unit} calculated in ${duration}ms. (Fallback: ${usedFallback})`);

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            activity_id: factor.activity_id,
            vendor: preAnalysis.vendor,
            audit: usedFallback ? "fallback_search_v2" : "direct_search_v2"
        };

    } catch (err) {
        console.error("❌ [CLIMATIQ_PIPELINE_ERROR]:", err.message);
        return null; 
    }
}

/**
 * Helper para búsqueda en Climatiq
 */
async function callClimatiqSearch(query, region) {
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&region=${region}&limit=1`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
    });
    return await res.json();
}

module.exports = { calculateInClimatiq };