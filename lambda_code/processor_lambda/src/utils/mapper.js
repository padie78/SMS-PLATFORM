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
    const consumptionLines = allLines.filter(line => {
        const u = (line.unit || '').toLowerCase();
        return u === 'kwh' || u === 'm3' || u === 'kg' || u === 'l';
    });

    const totalValue = consumptionLines.reduce((acc, line) => acc + Number(line.value || 0), 0);
    const displayUnit = consumptionLines[0]?.unit || "kWh";

    // --- LÓGICA DE CONFIANZA Y REVISIÓN REFINADA ---
    // Usamos parseFloat para manejar el "0.95" que ya nos devuelve Bedrock
    const confidence = parseFloat(aiData.confidence_score) || 0;
    
    // Condición de revisión dinámica:
    // Si confidence es 0.95, (0.95 < 0.8) es FALSE.
    // Pero si totalValue es 0 o no hay fechas, será TRUE.
    const hasDates = !!(invoice.period_start && invoice.period_end);
    const needsReview = confidence < 0.8 || totalValue === 0 || !hasDates;

    // --- HUELLA Y GASES ---
    const gases = footprint.constituent_gases || {};
    const totalCo2e = Number(footprint.total_kg || 0);
    const co2SafeValue = (gases.co2 && gases.co2 > 0) ? gases.co2 : totalCo2e;

    return {
        PK: partitionKey,
        SK: SK,

        ai_analysis: {
            activity_id: footprint.activity_id || "electricity-supply_grid_es",
            calculation_method: "consumption_based",
            confidence_score: confidence, 
            
            // Insight text dinámico para debuguear en DynamoDB
            insight_text: needsReview 
                ? `Revisión: ${confidence < 0.8 ? 'Baja Confianza ('+confidence+')' : 'Datos Incompletos (Consumo o Fechas)'}`
                : `Procesado Automático - Confianza: ${(confidence * 100).toFixed(0)}%`,

            requires_review: needsReview, // <--- Aquí se envía el booleano final
            service_type: (aiData.category || "ELEC").toUpperCase(),
            unit: displayUnit,
            value: totalValue,
            year: invoiceDate.split('-')[0]
        },

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