const { generarBusquedaSemantica, extraerValorEspecifico } = require("./bedrock");

const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "32.32";
const BASE_URL = "https://api.climatiq.io/data/v1";

/**
 * Orquestación dinámica con Fallback de Seguridad
 */
async function calculateInClimatiq(ocrSummary, queryHints = {}) {
    console.log("---------- [SEMANTIC CLIMATIQ FLOW] ----------");

    try {
        // --- PASO 1: ANÁLISIS INICIAL ---
        const preAnalysis = await generarBusquedaSemantica(ocrSummary, queryHints);
        const region = preAnalysis.region || "ES"; // Default a ES si estamos en España
        
        // --- PASO 2: BÚSQUEDA CON REINTENTO (FALLBACK) ---
        let searchData = await callClimatiqSearch(preAnalysis.search_query, region);

        // Si falla por vendor específico (como ELEIA), reintentamos por servicio genérico
        if (!searchData.results?.length) {
            console.warn(`⚠️ No factors for "${preAnalysis.search_query}". Trying fallback...`);
            
            // Construimos una búsqueda genérica basada en el tipo de servicio (elec, gas, fuel)
            const fallbackMap = { 'elec': 'electricity', 'gas': 'natural gas', 'fuel': 'diesel' };
            const genericQuery = fallbackMap[preAnalysis.service_type] || preAnalysis.service_type;
            
            searchData = await callClimatiqSearch(genericQuery, region);
        }

        if (!searchData.results?.length) {
            throw new Error(`Total Failure: No emission factors found even with fallback.`);
        }

        const factor = searchData.results[0];
        console.log(`✅ Factor Match: ${factor.activity_id} | Needs: ${factor.unit_type}`);

        // --- PASO 3: EXTRACCIÓN DIRIGIDA ---
        const extraction = await extraerValorEspecifico(ocrSummary, factor.unit_type);

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

        console.log("🚀 [CLIMATIQ_PAYLOAD]:", JSON.stringify(payload, null, 2));

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

        // Validamos que el resultado no sea 0 para evitar registros vacíos
        if (data.co2e === 0) {
            console.error("🚨 Calculation returned 0. Possible unit mismatch.");
        }

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            activity_id: factor.activity_id,
            vendor: preAnalysis.vendor,
            audit: searchData.is_fallback ? "fallback_search_v2" : "direct_search_v2"
        };

    } catch (err) {
        console.error("❌ [CLIMATIQ_PIPELINE_ERROR]:", err.message);
        return null; // El orquestador debe manejar este null y marcar el registro como ERROR
    }
}

/**
 * Helper para búsqueda limpia en Climatiq
 */
async function callClimatiqSearch(query, region) {
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&region=${region}&limit=1`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
    });
    return await res.json();
}

module.exports = { calculateInClimatiq };