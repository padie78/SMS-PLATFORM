/**
 * Invocación a Climatiq API v1/estimate
 * Adaptada para corregir el error 400 (invalid field: currency)
 */
async function calcularEnClimatiq(ai_analysis) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    
    // Usamos la key directa para descartar problemas de inyección de variables
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8";

    if (!apiKey) {
        console.error("[CLIMATIQ_CONFIG_ERROR]: API Key no encontrada.");
        return { co2e: 0, error: true, message: "Missing API Key" };
    }

    // 1. Normalización de Unidades
    const unitMap = { 
        "kilowatt-hour": "kWh", 
        "kilovatios": "kWh", 
        "kwh": "kWh", 
        "m3": "m3", 
        "litros": "l",
        "usd": "usd",
        "eur": "eur"
    };
    const normalizedUnit = unitMap[ai_analysis.unit?.toLowerCase()] || ai_analysis.unit;

    // 2. Construcción del Payload (FIX: Money Unit)
    const parameters = {};
    const valorNumerico = Number(ai_analysis.value) || 0;

    if (ai_analysis.calculation_method === "spend_based") {
        // CORRECTO: Climatiq v1 espera 'money' y 'money_unit'
        parameters.money = valorNumerico;
        parameters.money_unit = ai_analysis.unit?.toLowerCase() || "usd"; 
    } else {
        // CORRECTO: Activity-based
        const type = ai_analysis.parameter_type || "energy"; 
        parameters[type] = valorNumerico;
        parameters[`${type}_unit`] = normalizedUnit;
    }

    const body = {
        emission_factor: {
            activity_id: ai_analysis.activity_id || "electricity-supply_grid-source_production_mix",
            data_version: "^21" 
        },
        parameters
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        console.log(`[CLIMATIQ_DEBUG] Enviando Payload: ${JSON.stringify(body)}`);

        const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
            // Esto nos dirá exactamente qué campo falla si vuelve el 400
            throw new Error(`Climatiq_${response.status}: ${data.message || data.error_code}`);
        }

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit || "kg",
            activity_id: data.emission_factor?.activity_id,
            audit_trail: "climatiq_api_v1_estimate",
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        clearTimeout(timeout);
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        
        return { 
            co2e: 0, 
            co2e_unit: "kg", 
            error: true, 
            message: error.message,
            calculation_id: "ERROR_API_FALLBACK" 
        };
    }
}

module.exports = { calcularEnClimatiq };