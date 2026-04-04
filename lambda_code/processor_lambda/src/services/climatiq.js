import { STRATEGIES } from "../constants/climatiq_catalog.js";

// 1. Define tu objeto Mock al principio del archivo
const CLIMATIQ_MOCK_RESPONSE = {
    co2e: 47.7945,
    co2e_unit: "kg",
    activity_id: "electricity-supply_grid-source_supplier_mix",
    audit_trail: "enabled",
    constituent_gases: {
        co2: 47.7945,
        ch4: 0,
        n2o: 0
    }
};

export const calculateFootprint = async (lines, country = "ES") => {
    let totalKg = 0;
    let totalCo2 = 0;
    let totalCh4 = 0;
    let totalN2o = 0;
    
    const items = [];
    const CLIMATIQ_TOKEN = process.env.CLIMATIQ_TOKEN || "2E44QNZJMX5X5B6EM43E88KRZ8"; 
    // Variable para controlar el Mock (puedes usar process.env.USE_MOCK === 'true')
    const USE_MOCK = false; 

    for (const line of lines) {
        try {
            const strategy = STRATEGIES[line.category?.toUpperCase()] || STRATEGIES.ELEC;
            const value = parseFloat(line.value);
            const rawUnit = (line.unit || '').toLowerCase();

            const forbiddenUnits = ['eur', 'usd', 'money', '€', '$'];
            if (forbiddenUnits.includes(rawUnit) || isNaN(value)) {
                continue; 
            }

            let unit = rawUnit === 'kwh' ? 'kWh' : 'kg';

            // --- INICIO INTERCEPCIÓN MOCK ---
            let data;
            if (USE_MOCK) {
                console.log(`   🛠️ [MOCK_ACTIVE]: Simulando estimación para "${line.description}"`);
                data = CLIMATIQ_MOCK_RESPONSE; 
            } else {
                // Llamada real a la API
                const body = {
                    emission_factor: {
                        activity_id: strategy.activity_id,
                        region: country,
                        data_version: "^3" 
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

                data = await res.json();

                if (!res.ok) throw new Error(data.message || "Error API");
            }
            // --- FIN INTERCEPCIÓN MOCK ---

            // El resto del código sigue igual, usando 'data' (ya sea del Mock o de la API)
            totalKg += data.co2e;
            const gases = data.constituent_gases || {};
            
            totalCo2 += (gases.co2 || 0);
            totalCh4 += (gases.ch4 || 0);
            totalN2o += (gases.n2o || 0);

            items.push({
                description: line.description,
                original_value: value,
                original_unit: unit,
                co2e_kg: data.co2e,
                constituent_gases: gases,
                activity_id: strategy.activity_id,
                audit_trail: data.audit_trail 
            });

        } catch (err) {
            console.error(`   ⚠️ [LINE_ERROR] en "${line.description}": ${err.message}`);
        }
    }

    return { 
        total_kg: totalKg, 
        activity_id: items[0]?.activity_id || "electricity-supply_grid_es",
        constituent_gases: { co2: totalCo2, ch4: totalCh4, n2o: totalN2o },
        items 
    };
};