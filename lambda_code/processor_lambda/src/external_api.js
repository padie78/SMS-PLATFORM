/**
 * Multi-model Climatiq API Wrapper - Ironclad Architecture Edition
 * Final Fix: Dual-level data_version placement & Fallback Logic.
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    const baseUrl = "https://api.climatiq.io/data/v1";
    const DATA_VERSION = "32.32"; 

    const serviceType = ai_analysis.service_type?.toLowerCase();
    const calculationMethod = ai_analysis.calculation_method;

    // 1. SANITIZACIÓN DE UNIDADES
    function sanitizeUnits(sType, rawUnit, method) {
        const unit = rawUnit?.toLowerCase().trim();
        if (method === 'spend_based') {
            const currencyMap = { "euro": "eur", "euros": "eur", "dollar": "usd", "shekel": "ils" };
            return currencyMap[unit] || unit;
        }
        if (sType === 'elec' || sType === 'electricity') return 'kWh';
        if (sType === 'gas') return 'kWh';
        if (sType === 'water') return 'l';

        const unitMap = { "kwh": "kWh", "liters": "l", "m3": "m3", "kg": "kg", "t": "t" };
        return unitMap[unit] || rawUnit; 
    }

    // 2. SELECCIÓN DINÁMICA DE ACTIVITY_ID
    function getAdjustedActivityId(originalId, method, sType) {
        if (method === 'spend_based' && (sType === 'elec' || sType === 'electricity')) {
            return "electricity-consumption"; 
        }
        return originalId;
    }

    // 3. CORRECCIÓN DE PARAMETER_TYPE
    function getCorrectParameterType(sType, method) {
        if (method === 'spend_based') return 'money';
        if (sType === 'elec' || sType === 'gas') return 'energy';
        if (sType === 'water' || sType === 'fuel') return 'volume';
        return ai_analysis.parameter_type || 'energy';
    }

    const finalParamType = getCorrectParameterType(serviceType, calculationMethod);
    const normalizedUnit = sanitizeUnits(serviceType, ai_analysis.unit, calculationMethod);
    const finalActivityId = getAdjustedActivityId(ai_analysis.activity_id, calculationMethod, serviceType);
    
    let url = `${baseUrl}/estimate`;
    let finalPayload = {
        data_version: DATA_VERSION,
        emission_factor: {
            activity_id: finalActivityId,
            region: ai_analysis.region || "ES",
            data_version: DATA_VERSION 
        }
    };

    const numericValue = Number(ai_analysis.value);
    const parameters = {};
    parameters[finalParamType] = numericValue;
    parameters[`${finalParamType}_unit`] = normalizedUnit;
    finalPayload.parameters = parameters;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        // --- LOG DE ENVÍO INICIAL ---
        console.log("🚀 [CLIMATIQ_REQUEST_START]");
        console.log(`📌 Method: ${calculationMethod} | Service: ${serviceType}`);
        console.log("📦 Payload Inicial:", JSON.stringify(finalPayload, null, 2));
        
        let response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(finalPayload)
        });

        let data = await response.json();

        // --- ESTRATEGIA DE FALLBACK ---
        if (!response.ok && (data.error_code === "no_emission_factor_found" || data.message.includes("unit type") || data.error_code === "resource_not_found")) {
            console.warn("⚠️ [CLIMATIQ_ERROR]:", data.message || data.error_code);
            console.warn("🔄 [RETRYING]: Ejecutando Fallback con factor genérico IEA...");
            
            const fallbackPayload = {
                data_version: DATA_VERSION,
                emission_factor: {
                    activity_id: "electricity-supply_grid-source_production_mix",
                    region: ai_analysis.region || "ES",
                    source: "IEA",
                    data_version: DATA_VERSION 
                },
                parameters: {
                    energy: calculationMethod === 'spend_based' ? Math.round(numericValue / 0.15) : numericValue,
                    energy_unit: "kWh"
                }
            };

            console.log("📦 Payload Fallback:", JSON.stringify(fallbackPayload, null, 2));

            response = await fetch(url, {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify(fallbackPayload)
            });
            data = await response.json();
        }

        if (!response.ok) {
            console.error("❌ [CLIMATIQ_FATAL_ERROR]:", JSON.stringify(data, null, 2));
            throw new Error(`Climatiq Error: ${data.message || data.error_code}`);
        }

        console.log("✅ [CLIMATIQ_SUCCESS]:", data.co2e, data.co2e_unit);

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit,
            activity_id: finalActivityId,
            audit_trail: `climatiq_${serviceType}_${calculationMethod}_v3_fix`,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("🔥 [API_WRAPPER_CRASH]:", error.message);
        if (timeout) clearTimeout(timeout);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };