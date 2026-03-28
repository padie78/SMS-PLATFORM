/**
 * Multi-model Climatiq API Wrapper - Enterprise Edition
 * Corregido para evitar errores de mapeo de unidades (Energy/Money).
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; // Nota: Considera usar AWS Secrets Manager después.
    const baseUrl = "https://api.climatiq.io/data/v1";

    // 1. Normalización de Unidades (Climatiq Standard: todo en minúsculas)
    const unitMap = { 
        "kilowatt-hour": "kwh", "kwh": "kwh", 
        "liters": "l", "l": "l", "litros": "l", 
        "m3": "m3", "tons": "t", "t": "t", "toneladas": "t",
        "ils": "ils", "usd": "usd", "eur": "eur"
    };
    
    // Si no está en el mapa, lo pasamos a minúsculas por seguridad.
    const normalizedUnit = unitMap[ai_analysis.unit?.toLowerCase()] || ai_analysis.unit?.toLowerCase();
    
    const serviceType = ai_analysis.service_type?.toLowerCase() || "unknown";
    let url = `${baseUrl}/estimate`;
    let body = {};

    switch (serviceType) {
        
        case "freight": 
            url = `${baseUrl}/freight/v3/intermodal`;
            body = {
                route: ai_analysis.route || [],
                cargo: {
                    weight: Number(ai_analysis.value),
                    weight_unit: normalizedUnit || "t"
                }
            };
            break;

        case "travel":
            url = `${baseUrl}/travel/flights`;
            body = {
                legs: ai_analysis.legs || [],
                passengers: ai_analysis.passengers || 1
            };
            break;

        default: 
            const parameters = {};
            const numericValue = Number(ai_analysis.value) || 0;

            // Lógica Pro: Mapeo dinámico de parámetros para evitar 'invalid_unit_type'
            if (ai_analysis.calculation_method === "spend_based") {
                parameters.money = numericValue;
                parameters.money_unit = normalizedUnit || "usd";
            } else {
                // Si es 'elec', parameter_type debe ser 'energy'
                // Si es 'water', parameter_type debe ser 'volume'
                const paramKey = ai_analysis.parameter_type || "energy"; 
                
                parameters[paramKey] = numericValue;
                // REGLA CLIMATIQ: La unidad debe ser {parameter}_unit (ej: energy_unit)
                parameters[`${paramKey}_unit`] = normalizedUnit;
            }

            body = {
                // Importante: Climatiq para 'Electricity' requiere activity_id dentro de emission_factor
                emission_factor: {
                    activity_id: ai_analysis.activity_id,
                    region: ai_analysis.region || "IL"
                },
                parameters
            };
            break;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        // LOG SENIOR: Request estructurado para CloudWatch
        console.log("=== [CLIMATIQ_API_REQUEST] ===");
        console.log(`Endpoint: POST ${url}`);
        console.log("Payload:", JSON.stringify(body, null, 2)); // El null, 2 lo hace legible en los logs
        console.log("===============================");

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
            // LOG DE RECHAZO: Aquí verás por qué falló la unidad (ej: valid_values)
            console.error("❌ [CLIMATIQ_API_REJECTED]");
            console.error(`Status: ${response.status}`);
            console.error("Response:", JSON.stringify(data, null, 2));
            
            throw new Error(`Climatiq Error: ${data.message || data.error_code}`);
        }

        // LOG DE ÉXITO: Para trazabilidad financiera
        console.log(`✅ [CLIMATIQ_SUCCESS] Calculation ID: ${data.calculation_id || 'N/A'} | CO2e: ${data.co2e} ${data.co2e_unit}`);

        return {
            calculation_id: data.calculation_id || (data.emission_factor ? data.emission_factor.id : "N/A"),
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit || "kg",
            activity_id: ai_analysis.activity_id,
            audit_trail: `climatiq_${serviceType}_${ai_analysis.calculation_method}`,
            timestamp: new Date().toISOString(),
            metadata: {
                region: ai_analysis.region,
                year: ai_analysis.year || 2026
            }
        };

    } catch (error) {
        if (timeout) clearTimeout(timeout);
        
        // LOG DE EXCEPCIÓN: Errores de red o timeout
        console.error(`🚨 [CLIMATIQ_FATAL_ERROR] [${serviceType}]:`, error.message);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };