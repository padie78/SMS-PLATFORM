/**
 * Multi-model Climatiq API Wrapper - Strict Architecture Edition
 * Deterministic data handling: No fallbacks, strict versioning.
 */
async function calculateInClimatiq(ai_analysis) {
    const apiKey = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    const baseUrl = "https://api.climatiq.io/data/v1";
    const DATA_VERSION = "32.32"; // Latest version as per Climatiq error log

    const unitMap = { 
        "kilowatt-hour": "kwh", "kwh": "kwh", 
        "liters": "l", "l": "l", "litros": "l", 
        "m3": "m3", "cubic_meters": "m3",
        "tons": "t", "t": "t", "toneladas": "t",
        "eur": "eur", "usd": "usd", "ils": "ils"
    };
    
    const normalizedUnit = unitMap[ai_analysis.unit?.toLowerCase()] || ai_analysis.unit?.toLowerCase();
    const serviceType = ai_analysis.service_type?.toLowerCase();
    
    let url = `${baseUrl}/estimate`;
    let requestData = {}; // Temporal storage for switch logic

    switch (serviceType) {
        case "freight": 
            url = `${baseUrl}/freight/v3/intermodal`;
            requestData = {
                route: ai_analysis.route,
                cargo: { weight: Number(ai_analysis.value), weight_unit: normalizedUnit }
            };
            break;

        case "travel":
            url = `${baseUrl}/travel/flights`;
            requestData = {
                legs: ai_analysis.legs,
                passengers: ai_analysis.passengers
            };
            break;

        default: 
            const numericValue = Number(ai_analysis.value);
            const parameters = {};

            if (ai_analysis.calculation_method === "spend_based") {
                parameters.money = numericValue;
                parameters.money_unit = normalizedUnit;
            } else {
                const paramKey = ai_analysis.parameter_type; 
                parameters[paramKey] = numericValue;
                parameters[`${paramKey}_unit`] = normalizedUnit;
            }

            requestData = {
                emission_factor: {
                    activity_id: ai_analysis.activity_id,
                    region: ai_analysis.region
                },
                parameters: parameters
            };
            break;
    }

    // FINAL PAYLOAD CONSTRUCTION: Version is ALWAYS at the root.
    const finalPayload = {
        data_version: DATA_VERSION,
        ...requestData
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        console.log("=== [CLIMATIQ_API_REQUEST] ===");
        console.log(`Target URL: ${url}`);
        console.log("Payload:", JSON.stringify(finalPayload, null, 2));

        const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(finalPayload) // Using finalPayload explicitly
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
            console.error("❌ [CLIMATIQ_API_REJECTED]");
            console.error("Full Response:", JSON.stringify(data, null, 2));
            throw new Error(`Climatiq Error: ${data.message || data.error_code}`);
        }

        console.log(`✅ [CLIMATIQ_SUCCESS] CO2e: ${data.co2e} ${data.co2e_unit}`);

        return {
            calculation_id: data.calculation_id,
            co2e: Number(data.co2e),
            co2e_unit: data.co2e_unit,
            activity_id: ai_analysis.activity_id,
            audit_trail: `climatiq_${serviceType}_${ai_analysis.calculation_method}`,
            timestamp: new Date().toISOString(),
            metadata: {
                region: ai_analysis.region,
                year: ai_analysis.year
            }
        };

    } catch (error) {
        if (timeout) clearTimeout(timeout);
        console.error(`🚨 [CLIMATIQ_FATAL_ERROR] [${serviceType}]:`, error.message);
        throw error; 
    }
}

module.exports = { calculateInClimatiq };