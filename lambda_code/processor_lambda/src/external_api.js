/**
 * Multi-model Climatiq API Wrapper - Ironclad Architecture Edition
 * Final Fix: Strict unit-to-parameter mapping & global standardization.
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    const baseUrl = "https://api.climatiq.io/data/v1";
    const DATA_VERSION = "32.32"; 

    // 1. SANITIZACIÓN Y NORMALIZACIÓN DE UNIDADES
    function sanitizeUnits(serviceType, rawUnit, paramType) {
        const sType = serviceType?.toLowerCase();
        const unit = rawUnit?.toLowerCase().trim();

        // Casos de Fuerza Bruta por tipo de servicio (Evita errores de unit_type)
        if (sType === 'elec' || sType === 'electricity') return 'kWh';
        if (sType === 'gas' || sType === 'natural_gas') return 'kWh';
        if (sType === 'water' || sType === 'agua') return 'l'; // O 'm3'

        // Mapa de normalización general
        const unitMap = { 
            "kilowatt-hour": "kWh", "kwh": "kWh", "wh": "Wh", "mwh": "MWh",
            "liters": "l", "l": "l", "litros": "l", "m3": "m3", "cubic_meters": "m3",
            "tons": "t", "t": "t", "kg": "kg", "kilograms": "kg",
            "eur": "eur", "usd": "usd", "ils": "ils"
        };

        return unitMap[unit] || rawUnit; 
    }

    // 2. CORRECCIÓN DE PARAMETER_TYPE (El "corazón" del error de Climatiq)
    function getCorrectParameterType(serviceType, method) {
        if (method === 'spend_based') return 'money';
        const sType = serviceType?.toLowerCase();
        if (sType === 'elec' || sType === 'gas') return 'energy';
        if (sType === 'water' || sType === 'fuel' || sType === 'diesel') return 'volume';
        return ai_analysis.parameter_type || 'energy';
    }

    const serviceType = ai_analysis.service_type?.toLowerCase();
    const calculationMethod = ai_analysis.calculation_method;
    const finalParamType = getCorrectParameterType(serviceType, calculationMethod);
    const normalizedUnit = sanitizeUnits(serviceType, ai_analysis.unit, finalParamType);
    
    let url = `${baseUrl}/estimate`;
    let finalPayload = {
        data_version: DATA_VERSION 
    };

    // LOGICA DE CARGA (PAYLOAD)
    if (serviceType === "freight") {
        url = `${baseUrl}/freight/v3/intermodal`;
        finalPayload.route = ai_analysis.route;
        finalPayload.cargo = { 
            weight: Number(ai_analysis.value), 
            weight_unit: normalizedUnit 
        };
    } 
    else if (serviceType === "travel") {
        url = `${baseUrl}/travel/flights`;
        finalPayload.legs = ai_analysis.legs;
        finalPayload.passengers = ai_analysis.passengers;
    } 
    else {
        const numericValue = Number(ai_analysis.value);
        const parameters = {};

        if (calculationMethod === "spend_based") {
            parameters.money = numericValue;
            parameters.money_unit = normalizedUnit;
        } else {
            // Aquí forzamos que el nombre del parámetro coincida con el tipo de unidad
            // Evita enviar { volume: 500, volume_unit: 'kWh' } que rompe la API
            parameters[finalParamType] = numericValue;
            parameters[`${finalParamType}_unit`] = normalizedUnit;
        }

        finalPayload.emission_factor = {
            activity_id: ai_analysis.activity_id,
            region: ai_analysis.region,
            data_version: DATA_VERSION 
        };
        finalPayload.parameters = parameters;
    }

    // --- Ejecución de la petición (Fetch) ---
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        console.log(`=== [CLIMATIQ_STRICT_REQ] ${serviceType} ===`);
        const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(finalPayload)
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
            console.error("❌ [CLIMATIQ_REJECTED]", data.message);
            throw new Error(`Climatiq Error: ${data.message || data.error_code}`);
        }

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit,
            activity_id: ai_analysis.activity_id,
            audit_trail: `climatiq_${serviceType}_${calculationMethod}`,
            timestamp: new Date().toISOString(),
            metadata: { region: ai_analysis.region, year: ai_analysis.year }
        };

    } catch (error) {
        if (timeout) clearTimeout(timeout);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };