/**
 * Invocación a Climatiq API v1/estimate
 * Adaptado para el pipeline con Bedrock y Textract.
 */
async function calcularEnClimatiq(datosProcesadosPorIA) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    const apiKey = process.env.CLIMATIQ_API_KEY;

    if (!apiKey) {
        throw new Error("CLIMATIQ_API_KEY no configurada en variables de entorno.");
    }

    // Mapeamos el JSON de Bedrock al formato que espera Climatiq
    // Importante: Climatiq espera un campo dinámico en 'parameters' (energy, volume, weight, etc.)
    const body = {
        activity_id: datosProcesadosPorIA.activity_id,
        parameters: {
            [datosProcesadosPorIA.parameter_type]: datosProcesadosPorIA.value,
            [`${datosProcesadosPorIA.parameter_type}_unit`]: datosProcesadosPorIA.unit
        }
    };

    console.log(`[CLIMATIQ] Calculando para ID: ${body.activity_id}`);

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
            console.error(`[CLIMATIQ_ERROR] Status: ${response.status}`, data);
            // En producción, podrías lanzar el error o devolver un flag de revisión manual
            throw new Error(data.message || "Error en la estimación de Climatiq");
        }

        /**
         * La respuesta de Climatiq incluye:
         * - co2e: La cantidad de carbono
         * - co2e_unit: Generalmente 'kg'
         * - audit_trail: Información de la fuente (Vital para tu certificación)
         */
        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            source: data.audit_trail,
            calculation_id: data.calculation_id
        };

    } catch (error) {
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        // Evitá hardcodear 0.25 en producción; mejor marcá el registro como 'FAILED' en tu DB
        throw error; 
    }
}

module.exports = { calcularEnClimatiq };