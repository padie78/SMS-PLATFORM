import { STRATEGIES } from "../constants/climatiq_catalog.js";

export const calculateFootprint = async (lines, country = "ES") => {
    let totalKg = 0;
    const items = [];
    const CLIMATIQ_TOKEN = process.env.CLIMATIQ_API_KEY; // Recomendado usar env var
    const DATA_VERSION = "32.32"; 

    for (const line of lines) {
        try {
            const strategy = STRATEGIES[line.category?.toUpperCase()] || STRATEGIES.ELEC;
            const value = parseFloat(line.value);
            const unit = line.unit?.toLowerCase() === 'kwh' ? 'kWh' : (line.unit || 'kg');

            const body = {
                emission_factor: {
                    activity_id: strategy.activity_id,
                    region: country,
                    data_version: "^3" // Selector dinámico
                },
                parameters: {
                    ...(unit === 'kWh' 
                        ? { energy: value, energy_unit: "kWh" } 
                        : { weight: value, weight_unit: unit })
                }
            };

            const res = await fetch("https://api.climatiq.io/data/v1/estimate", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${CLIMATIQ_TOKEN}`,
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            totalKg += data.co2e;
            items.push({
                description: line.description,
                original_value: value,
                original_unit: unit,
                co2e_kg: data.co2e,
                activity_id: strategy.activity_id,
                audit_trail: data.audit_trail // Guardamos la fuente del factor
            });

        } catch (err) {
            console.error(`   ⚠️ [LINE_SKIP]: ${err.message}`);
        }
    }

    return { total_kg: totalKg, items };
};