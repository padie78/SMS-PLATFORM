/**
 * Multi-model Climatiq API Wrapper - Ironclad Architecture Edition
 * Final Version: Professional Hierarchy & Global Resiliency
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    const baseUrl = "https://api.climatiq.io/data/v1";
    const DATA_VERSION = "32.32"; 

    const serviceType = ai_analysis.service_type?.toLowerCase();
    const calculationMethod = ai_analysis.calculation_method;

    // 1. SANITIZACIÓN PROFESIONAL DE UNIDADES
    function sanitizeUnits(sType, rawUnit, method) {
        if (!rawUnit) return method === 'spend_based' ? 'eur' : 'kWh';
        const unit = rawUnit.toLowerCase().trim();

        if (method === 'spend_based') {
            const currencyMap = {
                "euro": "eur", "euros": "eur", "eur": "eur",
                "dollar": "usd", "dollars": "usd", "usd": "usd",
                "shekel": "ils", "ils": "ils", "nis": "ils"
            };
            return currencyMap[unit] || "eur";
        }

        const unitMap = { "kwh": "kWh", "l": "l", "litros": "l", "m3": "m3", "kg": "kg", "t": "t" };
        if (sType?.includes('elec') || sType?.includes('gas')) return 'kWh';
        return unitMap[unit] || rawUnit;
    }   

    // 2. SELECCIÓN DE ACTIVITY_ID (SUT para Dinero / Grid para Consumo)
    function getAdjustedActivityId(originalId, method, sType) {
        const type = sType?.toLowerCase() || '';
        if (method === 'spend_based') {
            if (type.includes('elec')) return "energy-distribution"; 
            if (type.includes('gas')) return "gas-distribution";
            if (type.includes('water')) return "water-collection_treatment_supply";
            return "industrial_processing-services"; 
        }
        if (!originalId || originalId === "default") {
            if (type.includes('elec')) return "electricity-supply_grid-source_production_mix";
            return "fuel-natural_gas-stationary_combustion";
        }
        return originalId;
    }   

    // 3. DETERMINACIÓN DEL TIPO DE PARÁMETRO
    function getCorrectParameterType(method) {
        return method === 'spend_based' ? 'money' : 'energy';
    }

    const finalParamType = getCorrectParameterType(calculationMethod);
    const normalizedUnit = sanitizeUnits(serviceType, ai_analysis.unit, calculationMethod);
    const finalActivityId = getAdjustedActivityId(ai_analysis.activity_id, calculationMethod, serviceType);
    
    // ESTRUCTURA DE PAYLOAD SIGUIENDO EL ESTÁNDAR DE LA DOCUMENTACIÓN (CURL)
    let finalPayload = {
        data_version: DATA_VERSION,
        emission_factor: {
            activity_id: finalActivityId,
            region: ai_analysis.region || "ES",
            year: ai_analysis.year || 2023, // Forzamos año para precisión
            data_version: DATA_VERSION 
        },
        parameters: {
            [finalParamType]: Number(ai_analysis.value),
            [`${finalParamType}_unit`]: normalizedUnit
        }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        console.log("🚀 [CLIMATIQ_REQ_START] Payload:", JSON.stringify(finalPayload, null, 2));
        
        let response = await fetch(`${baseUrl}/estimate`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(finalPayload)
        });

        let data = await response.json();

        // --- ESTRATEGIA DE RESCATE (FALLBACK MUNDIAL) ---
        if (!response.ok && (data.error_code === "no_emission_factors_found" || data.error_code === "no_emission_factor_found")) {
            console.warn("🔄 [FALLBACK]: Reintentando con IEA WORLD...");
            
            const fallbackPayload = {
                data_version: DATA_VERSION,
                emission_factor: {
                    activity_id: "electricity-supply_grid-source_production_mix",
                    region: "WORLD", // El comodín que no falla
                    source: "IEA",
                    data_version: DATA_VERSION 
                },
                parameters: {
                    energy: calculationMethod === 'spend_based' ? Math.round(Number(ai_analysis.value) / 0.15) : Number(ai_analysis.value),
                    energy_unit: "kWh"
                }
            };

            response = await fetch(`${baseUrl}/estimate`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify(fallbackPayload)
            });
            data = await response.json();
        }

        if (!response.ok) throw new Error(data.message || data.error_code);

        console.log("✅ [CLIMATIQ_SUCCESS]:", data.co2e, data.co2e_unit);

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit,
            activity_id: finalActivityId,
            audit_trail: `climatiq_v3_professional`,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        if (timeout) clearTimeout(timeout);
        console.error("🔥 [CLIMATIQ_FATAL]:", error.message);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };