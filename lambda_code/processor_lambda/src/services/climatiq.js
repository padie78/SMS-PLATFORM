import { STRATEGIES } from "../constants/climatiq_catalog.js";

export const calculateFootprint = async (lines, country = "ES") => {
    let totalKg = 0;
    const items = [];
    const CLIMATIQ_TOKEN = "2E44QNZJMX5X5B6EM43E88KRZ8";

    for (const [index, line] of lines.entries()) {
        try {
            const strategy = STRATEGIES[line.category?.toUpperCase()] || STRATEGIES.ELEC;
            const value = parseFloat(line.value);
            const unit = line.unit?.toLowerCase() === 'kwh' ? 'kWh' : (line.unit || 'kg');

            // Construcción del body siguiendo estrictamente el esquema /estimate
            const body = {
                data_version: "32.32",
                emission_factor: {
                    activity_id: strategy.activity_id,
                    region: country
                },
                parameters: {
                    ...(unit === 'kWh' ? { energy: value, energy_unit: 'kWh' } : { weight: value, weight_unit: unit })
                }
            };

            console.log(`      📤 [PAYLOAD_ENVÍO_${index + 1}]:`, JSON.stringify(body));

            const res = await fetch("https://api.climatiq.io/data/v1/estimate", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${CLIMATIQ_TOKEN.trim()}`,
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (!res.ok) {
                console.error(`      ❌ [API_ERROR]: ${data.message}`);
                continue;
            }

            totalKg += data.co2e;
            console.log(`      ✅ [OK]: ${data.co2e} kgCO2e`);

            items.push({ ...line, co2e_kg: data.co2e });

        } catch (error) {
            console.error(`      🚨 [LINE_ERROR]:`, error.message);
        }
    }

    return { total_tons: totalKg / 1000, total_kg: totalKg, items };
};