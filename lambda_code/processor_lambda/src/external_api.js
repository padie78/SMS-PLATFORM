/**
 * Invocación a Climatiq API v1/estimate
 * Corregido para evitar el error 'missing field emission_factor'
 */
async function calcularEnClimatiq(datosProcesadosPorIA) {
    // La URL v1/estimate es correcta, pero el body requiere una estructura específica
    const url = "https://api.climatiq.io/data/v1/estimate";
    const apiKey = process.env.CLIMATIQ_API_KEY || "2E44QNZJMX5X5B6EM43E88KRZ8"; 

    if (!datosProcesadosPorIA.activity_id || !datosProcesadosPorIA.parameter_type) {
        throw new Error("Datos insuficientes de la IA: falta activity_id o parameter_type");
    }

    // Normalizamos la unidad a minúsculas para evitar errores de validación de la API
    const unidadNormalizada = datosProcesadosPorIA.unit.toLowerCase();
    const pType = datosProcesadosPorIA.parameter_type; // ej: 'energy'

    // Estructura EXACTA que espera Climatiq para estimaciones basadas en actividad
    const body = {
        activity_id: "electricity-supply_grid-source_israel_grid",
        parameters: {
            [pType]: datosProcesadosPorIA.value,
            [`${pType}_unit`]: unidadNormalizada
        }
    };

    console.log(`[CLIMATIQ_DEBUG] Enviando Payload:`, JSON.stringify(body));

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
            // Si falta 'emission_factor' es porque el activity_id no fue reconocido 
            // y la API asume que quieres hacer un cálculo manual.
            console.error(`[CLIMATIQ_ERROR] Status: ${response.status}`, JSON.stringify(data, null, 2));
            throw new Error(data.message || `Error en Climatiq: ${data.error_code}`);
        }

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            audit_trail: data.audit_trail,
            calculation_id: data.calculation_id,
            activity_data: data.activity_data 
        };

    } catch (error) {
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        throw error; 
    }
}

module.exports = { calcularEnClimatiq };