/**
 * Invocación a Climatiq API v1/estimate
 * Exportada para uso externo en el pipeline de procesamiento.
 */
async function calcularEnClimatiq(ai_analysis) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    // Priorizamos EMISSIONS_API_KEY que es como lo tenés en Terraform
    const apiKey = (process.env.EMISSIONS_API_KEY || process.env.CLIMATIQ_API_KEY || "").trim();

    if (!apiKey) {
        console.error("[CLIMATIQ_CONFIG_ERROR]: API Key no encontrada en variables de entorno.");
        return { co2e: 0, error: true, message: "Missing API Key" };
    }

    // 1. Normalización de Unidades
    const unitMap = { "kilowatt-hour": "kWh", "kilovatios": "kWh", "kwh": "kWh", "m3": "m3", "litros": "l" };
    const normalizedUnit = unitMap[ai_analysis.unit?.toLowerCase()] || ai_analysis.unit;

    // 2. Construcción del Payload
    const parameters = {};
    if (ai_analysis.calculation_method === "spend_based") {
        parameters.money = Number(ai_analysis.value) || 0;
        parameters.currency = ai_analysis.unit?.toUpperCase() || "USD";
    } else {
        const type = ai_analysis.parameter_type || "energy"; 
        parameters[type] = Number(ai_analysis.value) || 0;
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
        const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
                // Formato Bearer: El estándar actual de Climatiq
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
        
        // Fallback para evitar que DynamoDB cancele la transacción por campos faltantes
        return { 
            co2e: 0, 
            co2e_unit: "kg", 
            error: true, 
            message: error.message,
            calculation_id: "ERROR_API_FALLBACK" 
        };
    }
}

// CRÍTICO: Esto permite que sea llamado desde el index.js u otros módulos
module.exports = { calcularEnClimatiq };