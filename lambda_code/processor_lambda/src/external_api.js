/**
 * Climatiq API Wrapper - SMS Project "Sentinel"
 * Versión: Professional Resiliency & Full Observability
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    const baseUrl = "https://api.climatiq.io/data/v1/estimate";
    const DATA_VERSION = "32.32"; 

    const serviceType = ai_analysis.service_type?.toLowerCase();
    const calculationMethod = ai_analysis.calculation_method;

    // --- MÉTODOS INTERNOS ---

    function sanitizeUnits(sType, rawUnit, method) {
        if (!rawUnit) return method === 'spend_based' ? 'eur' : 'kWh';
        const unit = rawUnit.toLowerCase().trim();
        if (method === 'spend_based') {
            const currencyMap = { "euro": "eur", "euros": "eur", "eur": "eur", "dollar": "usd", "shekel": "ils" };
            return currencyMap[unit] || "eur";
        }
        const unitMap = { "kwh": "kWh", "l": "l", "m3": "m3", "kg": "kg" };
        if (sType?.includes('elec') || sType?.includes('gas')) return 'kWh';
        return unitMap[unit] || rawUnit;
    }   

    function getAdjustedActivityId(method, sType) {
        const type = sType?.toLowerCase() || '';
        if (method === 'spend_based') {
            if (type.includes('elec')) return "energy-distribution"; 
            if (type.includes('gas')) return "gas-distribution";
            return "industrial_processing-services"; 
        }
        return "electricity-supply_grid-source_production_mix";
    }   

    const paramType = calculationMethod === 'spend_based' ? 'money' : 'energy';
    const unit = sanitizeUnits(serviceType, ai_analysis.unit, calculationMethod);
    const activityId = getAdjustedActivityId(calculationMethod, serviceType);
    
    // --- CONSTRUCCIÓN DEL PAYLOAD ---
    const finalPayload = {
        data_version: DATA_VERSION,
        emission_factor: {
            activity_id: activityId,
            region: ai_analysis.region || "ES",
            year: ai_analysis.year || 2023,
            data_version: DATA_VERSION 
        },
        parameters: {
            [paramType]: Number(ai_analysis.value),
            [`${paramType}_unit`]: unit
        }
    };

    const requestOptions = {
        method: "POST",
        headers: { 
            "Authorization": `Bearer ${apiKey}`, 
            "Content-Type": "application/json" 
        },
        body: JSON.stringify(finalPayload)
    };

    try {
        // LOG 1: ENVÍO INICIAL
        console.log("--------------------------------------------------");
        console.log("🚀 [CLIMATIQ] INICIANDO PETICIÓN");
        console.log("📡 URL:", baseUrl);
        console.log("📦 BODY ENVIADO:", JSON.stringify(finalPayload, null, 2));
        console.log("--------------------------------------------------");

        let response = await fetch(baseUrl, requestOptions);
        let data = await response.json();

        // --- LÓGICA DE FALLBACK ---
        if (!response.ok && (data.error_code === "no_emission_factors_found" || data.error_code === "no_emission_factor_found")) {
            console.warn("⚠️ [CLIMATIQ] Error: No se encontró el factor. Aplicando Fallback Global...");
            
            const fallbackPayload = {
                data_version: DATA_VERSION,
                emission_factor: {
                    activity_id: "electricity-supply_grid-source_production_mix",
                    region: "WORLD",
                    source: "IEA",
                    data_version: DATA_VERSION 
                },
                parameters: {
                    energy: calculationMethod === 'spend_based' ? Math.round(Number(ai_analysis.value) / 0.15) : Number(ai_analysis.value),
                    energy_unit: "kWh"
                }
            };

            // LOG 2: ENVÍO FALLBACK
            console.log("🔄 [CLIMATIQ] REINTENTO CON PAYLOAD GLOBAL:");
            console.log(JSON.stringify(fallbackPayload, null, 2));

            response = await fetch(baseUrl, {
                ...requestOptions,
                body: JSON.stringify(fallbackPayload)
            });
            data = await response.json();
        }

        if (!response.ok) {
            console.error("❌ [CLIMATIQ] ERROR FINAL:", data);
            throw new Error(data.message || data.error_code);
        }

        // LOG 3: ÉXITO
        console.log("✅ [CLIMATIQ] CÁLCULO EXITOSO:", data.co2e, data.co2e_unit);

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit,
            activity_id: activityId,
            audit_trail: response.url.includes("WORLD") ? "fallback_global" : "direct_match",
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("🔥 [CLIMATIQ] EXCEPCIÓN:", error.message);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };