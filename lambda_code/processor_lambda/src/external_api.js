/**
 * Invocación a Climatiq API v1/estimate
 * Optimizada para resiliencia y auditoría técnica.
 */
async function calcularEnClimatiq(ai_analysis) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    const apiKey = process.env.EMISSIONS_API_KEY;

    if (!apiKey) {
        console.error("[CLIMATIQ_CONFIG_ERROR]: API Key no configurada.");
        return null;
    }

    // 1. Normalización de Unidades (Blindaje contra Bedrock)
    // Evita que "kilovatios" o "KWH" rompan la API de Climatiq
    const unitMap = { "kilowatt-hour": "kWh", "kilovatios": "kWh", "kwh": "kWh", "m3": "m3", "litros": "l" };
    const normalizedUnit = unitMap[ai_analysis.unit?.toLowerCase()] || ai_analysis.unit;

    // 2. Construcción del Payload
    const parameters = {};
    if (ai_analysis.calculation_method === "spend_based") {
        parameters.money = Number(ai_analysis.value);
        parameters.currency = ai_analysis.unit?.toUpperCase() || "USD";
    } else {
        const type = ai_analysis.parameter_type || "energy"; 
        parameters[type] = Number(ai_analysis.value);
        parameters[`${type}_unit`] = normalizedUnit;
    }

    const body = {
        emission_factor: {
            activity_id: ai_analysis.activity_id || "electricity-supply_grid-source_production_mix",
            data_version: "^21" 
        },
        parameters
    };

    // 3. Control de Timeout (Evita que la Lambda pague tiempo de espera infinito)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 segundos max

    try {
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
            throw new Error(`Climatiq_${response.status}: ${data.message || data.error_code}`);
        }

        // 4. Retorno con metadata de auditoría (ISO 14064 ready)
        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit || "kg",
            activity_id: data.emission_factor?.activity_id,
            source: data.emission_factor?.source_name,
            uncertainty: data.uncertainty || null, // Nivel de duda del cálculo
            audit_trail: "climatiq_api_v1_estimate",
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error("[CLIMATIQ_TIMEOUT]: La API tardó demasiado.");
        } else {
            console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        }
        
        // Retornamos un objeto "Safe Fallback" para no romper el TransactWrite de DynamoDB
        return { co2e: 0, co2e_unit: "kg", error: true, message: error.message };
    }
}

module.exports = { calcularEnClimatiq };