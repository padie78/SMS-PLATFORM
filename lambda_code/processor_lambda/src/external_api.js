async function calcularEnClimatiq(datosProcesadosPorIA) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    // RECOMENDACIÓN: Usar variables de entorno siempre
    const apiKey = process.env.CLIMATIQ_API_KEY || "2E44QNZJMX5X5B6EM43E88KRZ8"; 

    // Construcción dinámica del payload
    const parameters = {};
    const pType = datosProcesadosPorIA.parameter_type; // Ej: 'energy'
    
    parameters[pType] = datosProcesadosPorIA.value;
    parameters[`${pType}_unit`] = datosProcesadosPorIA.unit; // Ej: 'energy_unit': 'kWh'

    const body = {
        activity_id: datosProcesadosPorIA.activity_id,
        parameters: parameters
    };

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
            // Logueamos el error completo de Climatiq para depurar IDs de actividad inválidos
            console.error(`[CLIMATIQ_ERROR]`, JSON.stringify(data, null, 2));
            throw new Error(`Climatiq API Error: ${data.error || data.message}`);
        }

        return {
            co2e: data.co2e,
            unit: data.co2e_unit,
            audit_trail: data.audit_trail, // Crucial para reportes de sostenibilidad
            calculation_id: data.calculation_id,
            activity_data: data.activity_data // Información extra sobre el factor de emisión usado
        };

    } catch (error) {
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        throw error; 
    }
}