import crypto from 'crypto';

/**
 * Mapea la respuesta de la IA y Climatiq a un Golden Record para DynamoDB.
 * Incluye desglose de gases (CO2, CH4, N2O) y estrategia de Deduplicación Natural.
 */
export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const now = new Date().toISOString();
    
    // 1. Extraer datos de entrada (IA)
    const extData = aiData.extracted_data || {};
    const invoice = extData.invoice || {};
    const totalObj = extData.total_amount || {};
    const vendor = extData.vendor || {};

    // 2. Lógica de Deduplicación: Generación de la SK Natural
    const vendorClean = (vendor.name || "UNKNOWN").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const numberClean = (invoice.number || "NONUM").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const invoiceDate = invoice.date || "0000-00-00";
    const SK = `INV#${vendorClean}#${numberClean}`;

    // 3. Sanitización de Datos Numéricos y Gases
    const rawTotal = totalObj.total || 0;
    const cleanAmount = typeof rawTotal === 'string' 
        ? parseFloat(rawTotal.replace(/[^0-9.,]/g, '').replace(',', '.')) 
        : Number(rawTotal);

    const confidence = Number(aiData.confidence_score || 0);

    // NUEVO: Extracción de gases específicos de Climatiq
    const gases = footprint.constituent_gases || {};

    // 4. Construcción del Objeto Final
    return {
        PK: partitionKey,
        SK: SK,

        ai_analysis: {
            activity_id: footprint.activity_id,
            calculation_method: "consumption_based",
            confidence_score: confidence,
            insight_text: aiData.analysis_summary || `Processed invoice from ${vendor.name}`,
            requires_review: (confidence < 0.8),
            service_type: (aiData.category || "ELEC").toUpperCase(),
            unit: aiData.emission_lines?.[0]?.unit || "kWh",
            value: Number(aiData.emission_lines?.[0]?.value || 0),
            year: invoiceDate.split('-')[0]
        },

        analytics_dimensions: {
            period_month: parseInt(invoiceDate.split('-')[1]) || 0,
            period_year: parseInt(invoiceDate.split('-')[0]) || 0,
            sector: "COMMERCIAL"
        },

        // ACTUALIZADO: Bloque Climatiq con desglose de gases
        climatiq_result: {
            co2e: Number(footprint.total_kg || footprint.co2e || 0), // Total Equivalente
            co2: Number(gases.co2 || 0),   // Dióxido de Carbono puro
            ch4: Number(gases.ch4 || 0),   // Metano
            n2o: Number(gases.n2o || 0),   // Óxido Nitroso
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
            total_amount: isNaN(cleanAmount) ? 0 : cleanAmount,
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

export default { buildGoldenRecord };