import { STRATEGIES } from "../constants/climatiq_catalog.js";

export const calculateFootprint = async (lines, country = "ES") => {
    let totalKg = 0;
    // NUEVO: Acumuladores para el desglose total de la factura
    let totalCo2 = 0;
    let totalCh4 = 0;
    let totalN2o = 0;
    
    const items = [];
    const CLIMATIQ_TOKEN = process.env.CLIMATIQ_TOKEN || "2E44QNZJMX5X5B6EM43E88KRZ8"; 

    for (const line of lines) {
        try {
            const strategy = STRATEGIES[line.category?.toUpperCase()] || STRATEGIES.ELEC;
            const value = parseFloat(line.value);
            const unit = line.unit?.toLowerCase() === 'kwh' ? 'kWh' : (line.unit || 'kg');

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

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            // 1. Acumulamos el CO2e total
            totalKg += data.co2e;

            // 2. NUEVO: Acumulamos los gases constituyentes si existen
            const gases = data.constituent_gases || {};
            totalCo2 += (gases.co2 || 0);
            totalCh4 += (gases.ch4 || 0);
            totalN2o += (gases.n2o || 0);

            items.push({
                description: line.description,
                original_value: value,
                original_unit: unit,
                co2e_kg: data.co2e,
                constituent_gases: gases, // Guardamos el detalle por línea
                activity_id: strategy.activity_id,
                audit_trail: data.audit_trail 
            });

        } catch (err) {
            console.error(`   ⚠️ [LINE_SKIP]: ${err.message}`);
        }
    }

    // 3. Retornamos el objeto completo que espera el Mapper
    return { 
        total_kg: totalKg, 
        constituent_gases: {
            co2: totalCo2,
            ch4: totalCh4,
            n2o: totalN2o
        },
        items 
    };
};