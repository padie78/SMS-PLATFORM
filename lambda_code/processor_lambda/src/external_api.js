/**
 * Invocación a Climatiq API v1/estimate
 * Siguiendo estrictamente la estructura del cURL oficial
 */
async function calcularEnClimatiq(datosProcesadosPorIA) {
    const url = "https://api.climatiq.io/data/v1/estimate";
    const apiKey = process.env.CLIMATIQ_API_KEY || "2E44QNZJMX5X5B6EM43E88KRZ8"; 

    // ESTRUCTURA SEGÚN TU CURL: El activity_id VA DENTRO de emission_factor
    const body = {
        "emission_factor": {
            // Este ID es el que usa Climatiq en su documentación de ejemplo
            "activity_id": "electricity-supply_grid-source_residual_mix",
            "data_version": "^21" 
        },
        "parameters": {
            "energy": Number(datosProcesadosPorIA.value) || 10,
            "energy_unit": "kWh" // Mantén la 'W' mayúscula como en el cURL
        }
    };

    console.log(`[CLIMATIQ_DEBUG] Enviando estructura oficial:`, JSON.stringify(body));

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
            console.error(`[CLIMATIQ_ERROR] Status: ${response.status}`, JSON.stringify(data, null, 2));
            throw new Error(data.message || `Error en Climatiq: ${data.error_code}`);
        }

        // Devolvemos el resultado mapeado
        return {
            calculation_id: data.calculation_id, // <--- ESTO ES LO QUE TE FALTA
            co2e: data.co2e,
            unit: data.co2e_unit || data.unit,
            activity_id: data.emission_factor?.activity_id || "N/A",
            audit_trail: data.audit_trail,
            // Tip: agrega el factor de emisión para auditoría
            source: data.emission_factor?.source || "Climatiq"
        };

    } catch (error) {
        console.error("[CLIMATIQ_EXCEPTION]:", error.message);
        throw error; 
    }
}

module.exports = { calcularEnClimatiq };