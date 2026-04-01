import { STRATEGIES } from "../constants/climatiq_catalog.js";

/**
 * Servicio de Cálculo de Huella de Carbono (Climatiq API).
 * Ahora con LOGS detallados por línea de emisión.
 */
export const calculateFootprint = async (lines, country = "ES") => {
    console.log(`   [CLIMATIQ_START]: Procesando ${lines?.length || 0} líneas para región: ${country}`);
    
    let totalKg = 0;
    const items = [];

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
        console.warn(`   ⚠️ [CLIMATIQ_EMPTY]: No se recibieron líneas de emisión de la IA.`);
        return { total_tons: 0, total_kg: 0, items: [] };
    }

    for (const [index, line] of lines.entries()) {
        // Log de entrada para auditoría visual en CloudWatch
        console.log(`      📝 [LINEA_${index + 1}]: ID: ${line.activity_id || 'N/A'} | Val: ${line.value} ${line.unit} | Desc: ${line.description?.substring(0, 30)}...`);

        try {
            // Construimos el body dinámicamente según lo que extrajo Bedrock
            const body = {
                emission_factor: { 
                    activity_id: line.activity_id || "electricity-supply_grid_mix", // Default seguro
                    region: country 
                },
                parameters: { 
                    money: line.value, 
                    money_unit: line.unit 
                }
            };

            // Si la IA detectó que es consumo (kWh, kg, etc) y no dinero:
            if (line.unit !== 'EUR' && line.unit !== 'USD') {
                const unitType = line.unit === 'kWh' ? 'energy' : 'weight';
                body.parameters = {
                    [unitType]: line.value,
                    [`${unitType}_unit`]: line.unit
                };
            }

            const token = "2E44QNZJMX5X5B6EM43E88KRZ8";

            const res = await fetch("https://api.climatiq.io/data/v1/estimate", {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${token?.trim()}`, // .trim() por seguridad
                    "Content-Type": "application/json" 
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errorData = await res.json();
                console.error(`      ❌ [API_ERROR_LINEA_${index + 1}]: ${errorData.message}`);
                continue;
            }

            const data = await res.json();
            const co2 = data.co2e || 0;
            
            console.log(`      ✅ [RESULTADO_LINEA_${index + 1}]: ${co2.toFixed(4)} kgCO2e`);

            totalKg += co2;
            items.push({ 
                ...line, 
                co2e_kg: co2,
                audit_trail: data.audit_trail 
            });

        } catch (error) {
            console.error(`      🚨 [NETWORK_ERROR_LINEA_${index + 1}]:`, error.message);
        }
    }

    console.log(`   [CLIMATIQ_END]: Total acumulado: ${totalKg.toFixed(4)} kgCO2e (${(totalKg / 1000).toFixed(6)} t)`);

    return { 
        total_tons: totalKg / 1000, 
        total_kg: totalKg,
        items 
    };
};

export default { calculateFootprint };