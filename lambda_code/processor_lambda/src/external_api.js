/**
 * Invocación a Climatiq API v1/estimate
 * Adaptada para manejar múltiples tipos de servicios y métodos de cálculo.
 */
async function calcularEnClimatiq(ai_analysis) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    // RECOMENDACIÓN: Siempre usa variables de entorno para la API Key
    const apiKey = process.env.CLIMATIQ_API_KEY; 

    // 1. Construcción dinámica de los parámetros según la decisión de Bedrock
    const parameters = {};
    
    if (ai_analysis.calculation_method === "spend_based") {
        // Si no hubo unidades físicas, usamos dinero
        parameters.money = Number(ai_analysis.value);
        parameters.currency = ai_analysis.unit; // En este caso unit trae el ISO de moneda (ARS, USD)
    } else {
        // Si hubo unidades físicas (kWh, m3, l, etc.)
        const type = ai_analysis.parameter_type; // 'energy', 'volume', 'weight'
        parameters[type] = Number(ai_analysis.value);
        parameters[`${type}_unit`] = ai_analysis.unit;
    }

    // 2. Estructura del Body según la documentación de Climatiq
    const body = {
        "emission_factor": {
            "activity_id": ai_analysis.activity_id,
            "data_version": "^21" 
        },
        "parameters": parameters
    };

    console.log(`[CLIMATIQ_INVOKE] Metodo: ${ai_analysis.calculation_method} | Activity: ${ai_analysis.activity_id}`);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            // Manejo de errores específico de Climatiq
            console.error(`[CLIMATIQ_ERROR] Status: ${response.status}`, JSON.stringify(data, null, 2));
            throw new Error(`Climatiq API Error: ${data.message || data.error_code}`);
        }

        // 3. Retorno de datos para el "Golden Record" de DynamoDB
        return {
            calculation_id: data.calculation_id, 
            co2e: data.co2e,
            co2e_unit: data.co2e_unit,
            activity_id: data.emission_factor?.activity_id,
            intensity_factor: data.constituent_gases?.co2e_total || 0, // Útil para auditorías profundas
            audit_trail: data.audit_trail,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        // Devolvemos un objeto vacío o nulo para que la Lambda principal pueda manejar el fallback
        return null; 
    }
}

module.exports = { calcularEnClimatiq };