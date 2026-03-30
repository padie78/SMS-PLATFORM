const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "^32"; 
const BASE_URL = "https://api.climatiq.io/data/v1";

const { extraerValorEspecifico, generarBusquedaSemantica } = require("./bedrock");

/**
 * [MÉTODO A]: CÁLCULO DINÁMICO DE CARBONO
 * Orquestación: Búsqueda Global (FREE) -> Extracción Bedrock -> Estimate
 */
async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    const startTime = Date.now();
    console.log("---------- [SEMANTIC CLIMATIQ FLOW START] ----------");

    try {
        // 1. Análisis Semántico para obtener la query de búsqueda
        const preAnalysis = await generarBusquedaSemantica(ocrSummary, queryHints);
        const searchQuery = preAnalysis.search_query; 
        console.log(`[INFO] Intent Query: "${searchQuery}"`);

        // 2. Búsqueda Global de Factores (Solo FREE, sin filtro de región para máxima visibilidad)
        const searchData = await callClimatiqSearch(searchQuery);

        if (!searchData.results?.length) {
            throw new Error(`Critical: No free factors found at all for "${searchQuery}"`);
        }

        // Log de auditoría de los primeros matches encontrados
        console.log(`=== [CLIMATIQ_FREE_FACTORS_FOUND: ${searchData.results.length}] ===`);
        searchData.results.forEach((res, index) => {
            console.log(`${index + 1}. ID: ${res.activity_id} | Region: ${res.region} | Units: ${res.unit_type}`);
        });

        // Selección del factor con mejor ranking
        const factor = searchData.results[0];
        console.log(`[INFO] Selected Factor: ${factor.activity_id} (Region: ${factor.region})`);

        // 3. Extracción de valores específicos según lo que pida el factor
        const extractions = await extraerValorEspecifico(ocrSummary, factor.unit_type);

        // 4. Construcción Dinámica del Payload con LOOP (Escalable)
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
                region: factor.region 
            },
            parameters: parameters
        };

        console.log("🚀 [ESTIMATE_PAYLOAD]:", JSON.stringify(payload, null, 2));

        // 5. Llamada al endpoint de estimación
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

        console.log(`✅ [CLIMATIQ_SUCCESS]: ${data.co2e} ${data.co2e_unit} en ${Date.now() - startTime}ms.`);

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            activity_id: factor.activity_id,
            vendor: preAnalysis.vendor,
            region_used: factor.region
        };

    } catch (err) {
        console.error("❌ [CLIMATIQ_PIPELINE_ERROR]:", err.message);
        return null; 
    }
}

/**
 * [MÉTODO B]: EXPLORADOR DE CATÁLOGO (Uso administrativo/auditoría)
 * Lista todos los factores gratuitos que coincidan con la query.
 */
async function exploreFreeActivities(query = "") {
    const startTime = Date.now();
    console.log(`---------- [CLIMATIQ EXPLORER: START] ----------`);
    console.log(`[SEARCHING]: ${query || "ALL FREE FACTORS"}`);

    try {
        let url = `${BASE_URL}/search?access_type=public&results_per_page=100`;
        if (query) url += `&query=${encodeURIComponent(query)}`;

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Search failed");

        console.log(`=== [TOTAL FREE FACTORS FOUND: ${data.results?.length || 0}] ===`);
        
        data.results?.forEach((f, i) => {
            console.log(`${i+1}. [${f.activity_id}]`);
            console.log(`   Name: ${f.name}`);
            console.log(`   Region: ${f.region} | Units: ${f.unit_type} | Source: ${f.source} (${f.year})`);
            console.log('   -----------------------------------');
        });

        return data.results || [];
    } catch (err) {
        console.error("❌ [EXPLORER_ERROR]:", err.message);
        return [];
    }
}

/**
 * Helper interno para búsqueda dinámica
 */
async function callClimatiqSearch(query) {
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&access_type=free&limit=15`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
    });
    return await res.json();
}

module.exports = { 
    calculateInClimatiq, 
    exploreFreeActivities 
};