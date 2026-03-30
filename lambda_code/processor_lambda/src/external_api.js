const { generarBusquedaSemantica, extraerValorEspecifico } = require("./bedrock");

const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "^32"; 
const BASE_URL = "https://api.climatiq.io/data/v1";

/**
 * Orquestación con Log detallado de todos los Activity IDs encontrados
 */
async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    const startTime = Date.now();
    console.log("---------- [SEMANTIC CLIMATIQ FLOW START] ----------");

    try {
        const preAnalysis = await generarBusquedaSemantica(ocrSummary, queryHints);
        const region = preAnalysis.region || "ES";
        const searchQuery = preAnalysis.search_query; 
        
        console.log(`[INFO] Intent Query: "${searchQuery}" | Region: ${region}`);

        // --- PASO 2: BÚSQUEDA Y LOG DE ACTIVIDADES ---
        let searchData = await callClimatiqSearch(searchQuery, region);
        
        if (!searchData.results?.length) {
            console.warn(`[WARN] No FREE factors for "${searchQuery}" in ${region}. Trying Global...`);
            searchData = await callClimatiqSearch(searchQuery, "WORLD");
        }

        if (!searchData.results?.length) {
            throw new Error(`Critical: No free factors found for "${searchQuery}"`);
        }

        // --- LOG DE TODAS LAS ACTIVIDADES ENCONTRADAS ---
        console.log("=== [CLIMATIQ_ACTIVITIES_FOUND] ===");
        searchData.results.forEach((res, index) => {
            console.log(`${index + 1}. ID: ${res.activity_id}`);
            console.log(`   Desc: ${res.name || 'No description'}`);
            console.log(`   Year: ${res.year} | Source: ${res.source}`);
            console.log(`   Unit Type: ${res.unit_type}`);
            console.log('   -----------------------------------');
        });

        // Seleccionamos el primero para el cálculo
        const factor = searchData.results[0];
        console.log(`[INFO] Selected for Calculation: ${factor.activity_id}`);

        // --- PASO 3: EXTRACCIÓN MULTI-PARAM ---
        const extractions = await extraerValorEspecifico(ocrSummary, factor.unit_type);

        // --- PASO 4: LOOP DE PARÁMETROS ---
        const parameters = {};
        Object.keys(extractions).forEach(key => {
            const data = extractions[key];
            if (data && data.value !== undefined) {
                parameters[key] = Number(data.value);
                parameters[`${key}_unit`] = data.unit.toLowerCase();
                if (data.currency) parameters.currency = data.currency;
            }
        });

        const payload = {
            data_version: DATA_VERSION,
            emission_factor: {
                activity_id: factor.activity_id,
                region: region
            },
            parameters: parameters
        };

        // --- PASO 5: ESTIMACIÓN ---
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

        console.log(`✅ [CLIMATIQ_SUCCESS]: ${data.co2e} ${data.co2e_unit}`);

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            activity_id: factor.activity_id,
            vendor: preAnalysis.vendor
        };

    } catch (err) {
        console.error("❌ [CLIMATIQ_PIPELINE_ERROR]:", err.message);
        return null; 
    }
}

/**
 * Helper: Búsqueda libre con límite aumentado para ver más opciones
 */
async function callClimatiqSearch(query, region) {
    // Subimos el limit a 5 para poder loguear varias opciones
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&region=${region}&access_type=free&limit=5`;
    
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
    });
    return await res.json();
}

module.exports = { calculateInClimatiq };