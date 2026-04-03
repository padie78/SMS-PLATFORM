import crypto from 'crypto';

export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const now = new Date().toISOString();
    
    const extData = aiData.extracted_data || {};
    const invoice = extData.invoice || {};
    const totalObj = extData.total_amount || {};
    const vendor = extData.vendor || {};
    const invoiceDate = invoice.date || "0000-00-00";

    // 1. SK Natural para evitar duplicados
    const vendorClean = (vendor.name || "UNKNOWN").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const numberClean = (invoice.number || "NONUM").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const SK = `INV#${vendorClean}#${numberClean}`;

    // --- LÓGICA DE FILTRADO PARA EL CONSUMO ---
    const allLines = aiData.emission_lines || [];
    
    // 2. Filtramos solo las líneas que son de consumo real (ej. kWh) 
    // Ignoramos explícitamente EUR, €, etc., para que no ensucien el 'value'
    const consumptionLines = allLines.filter(line => {
        const u = (line.unit || '').toLowerCase();
        return u === 'kwh' || u === 'm3' || u === 'kg' || u === 'l';
    });

    // 3. Sumamos solo los valores de consumo (Dará 1123 en tu factura de Fenosa)
    const totalValue = consumptionLines.reduce((acc, line) => acc + Number(line.value || 0), 0);
    
    // 4. Determinamos la unidad de visualización (priorizando kWh)
    const displayUnit = consumptionLines[0]?.unit || "kWh";

    // 5. Huella y Gases (Viene de tu service corregido)
    const gases = footprint.constituent_gases || {};
    const totalCo2e = Number(footprint.total_kg || 0);
    const co2SafeValue = (gases.co2 && gases.co2 > 0) ? gases.co2 : totalCo2e;

    return {
        PK: partitionKey,
        SK: SK,

        ai_analysis: {
            // Usamos el activity_id que ahora devuelve tu service corregido
            activity_id: footprint.activity_id || "electricity-supply_grid_es",
            calculation_method: "consumption_based",
            confidence_score: Number(aiData.confidence_score || 0),
            insight_text: aiData.analysis_summary || `Factura de ${vendor.name} procesada.`,
            requires_review: (Number(aiData.confidence_score || 0) < 0.8),
            service_type: (aiData.category || "ELEC").toUpperCase(),
            unit: displayUnit, // Ahora será 'kWh' y no 'EUR'
            value: totalValue,  // Ahora será '1123' y no '1189.57'
            year: invoiceDate.split('-')[0]
        },

        // Mantenemos el detalle de TODAS las líneas (incluyendo las de EUR) para el usuario
        line_items: allLines.map((line, index) => ({
            id: index + 1,
            description: line.description,
            value: Number(line.value || 0),
            unit: line.unit || "EUR"
        })),

        analytics_dimensions: {
            period_month: parseInt(invoiceDate.split('-')[1]) || 0,
            period_year: parseInt(invoiceDate.split('-')[0]) || 0,
            sector: "COMMERCIAL"
        },

        climatiq_result: {
            co2e: totalCo2e,
            co2: Number(co2SafeValue),
            ch4: Number(gases.ch4 || 0),
            n2o: Number(gases.n2o || 0),
            co2e_unit: "kg",
            timestamp: now
        },

        extracted_data: {
            billing_period: {
                start: invoice.period_start || null,
                end: invoice.period_end || null
            },
            currency: totalObj.currency || "EUR",
            invoice_date: invoiceDate,
            invoice_number: invoice.number || "NO-NUMBER",
            total_amount: Number(totalObj.total || 0),
            vendor: vendor.name || "Unknown Vendor"
        },

        metadata: {
            filename: s3Key.split('/').pop(),
            s3_key: s3Key,
            status: "PROCESSED",
            upload_date: now,
            technical_hash: crypto.createHash('sha256').update(s3Key).digest('hex').substring(0, 8)
        }
    };
};