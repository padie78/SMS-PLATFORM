import { STRATEGIES } from "../constants/climatiq_catalog.js";

export const calculateFootprint = async (lines, country = "ES") => {
    console.log(`   [CLIMATIQ_START]: Procesando ${lines?.length || 0} líneas...`);
    
    let totalKg = 0;
    const items = [];
    const CLIMATIQ_TOKEN = "2E44QNZJMX5X5B6EM43E88KRZ8";
    const DATA_VERSION = "32.32"; 

    for (const [index, line] of lines.entries()) {
        try {
            // --- 1. MAPEADO DE ACTIVITY_ID ---
            // Buscamos en el catálogo usando la categoría que envió la IA (ej: ELEC, GAS, etc.)
            const strategy = STRATEGIES[line.category] || STRATEGIES.ELEC; 
            const realActivityId = strategy.activity_id;

            console.log(`      🔍 [MAPPER]: Categoría '${line.category}' -> ID: ${realActivityId}`);

            const unit = line.unit?.toLowerCase();
            const value = parseFloat(line.value);

            // --- 2. CONSTRUCCIÓN DE PARÁMETROS LIMPIOS ---
            let cleanParameters = {};
            if (unit === 'eur' || unit === 'usd') {
                cleanParameters = { money: value, money_unit: unit };
            } else if (unit === 'kwh') {
                cleanParameters = { energy: value, energy_unit: 'kwh' };
            } else if (unit === 'km') {
                cleanParameters = { distance: value, distance_unit: 'km' };
            } else {
                cleanParameters = { weight: value, weight_unit: unit || 'kg' };
            }

            const body = {
                data_version: DATA_VERSION,
                emission_factor: { 
                    activity_id: realActivityId
                },
                parameters: cleanParameters
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

            if (!res.ok) {
                const errorData = await res.json();
                console.error(`      ❌ [API_ERROR]: ${errorData.message}`);
                continue;
            }

            const data = await res.json();
            totalKg += data.co2e || 0;
            
            items.push({ 
                ...line, 
                activity_id: realActivityId, // Guardamos el ID real usado
                co2e_kg: data.co2e,
                audit_trail: data.audit_trail 
            });

        } catch (error) {
            console.error(`      🚨 [LINE_ERROR]:`, error.message);
        }
    }

    return { total_tons: totalKg / 1000, total_kg: totalKg, items };
};

export default { calculateFootprint };