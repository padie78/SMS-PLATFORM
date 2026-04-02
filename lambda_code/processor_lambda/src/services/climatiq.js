import { STRATEGIES } from "../constants/climatiq_catalog.js";

export const calculateFootprint = async (lines, country = "ES") => {
    let totalKg = 0;
    const items = [];
    const CLIMATIQ_TOKEN = "2E44QNZJMX5X5B6EM43E88KRZ8";
    const DATA_VERSION = "32.32"; 

    for (const [index, line] of lines.entries()) {
        try {
            const strategy = STRATEGIES[line.category?.toUpperCase()] || STRATEGIES.ELEC;
            const value = parseFloat(line.value);
            const unit = line.unit?.toLowerCase() === 'kwh' ? 'kWh' : (line.unit || 'kg');

            // --- CONSTRUCCIÓN DEL PAYLOAD ---
            // Eliminamos data_version de aquí para evitar el error de la columna 117
            const body = {
                emission_factor: {
                    activity_id: strategy.activity_id,
                    region: country || "ES"
                },
                parameters: {
                    ...(unit === 'kWh' 
                        ? { energy: value, energy_unit: 'kWh' } 
                        : { weight: value, weight_unit: unit })
                }
            };

            // --- URL CON LA VERSIÓN EXPLÍCITA ---
            const url = `https://api.climatiq.io/data/v1/estimate?data_version=${DATA_VERSION}`;

            console.log(`      📤 [PAYLOAD_ENVÍO_${index + 1}]:`, JSON.stringify(body));

            const res = await fetch(url, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${CLIMATIQ_TOKEN.trim()}`,
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (!res.ok) {
                // Si falla, el log nos dirá EXACTAMENTE qué falta en el selector
                console.error(`      ❌ [API_ERROR_L${index+1}]: ${data.message} (ID: ${data.request_id})`);
                continue;
            }

            const co2 = data.co2e || 0;
            console.log(`      ✅ [OK_L${index+1}]: ${co2.toFixed(4)} kgCO2e`);

            totalKg += co2;
            items.push({ ...line, co2e_kg: co2 });

        } catch (error) {
            console.error(`      🚨 [LINE_ERROR_L${index+1}]:`, error.message);
        }
    }

    return { total_tons: totalKg / 1000, total_kg: totalKg, items };
};