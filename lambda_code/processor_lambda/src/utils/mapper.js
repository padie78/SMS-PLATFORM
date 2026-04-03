import crypto from 'crypto';

/**
 * Mapea la respuesta de la IA (Bedrock) y el cálculo (Climatiq) a un Golden Record.
 * Implementa suma de líneas múltiples, protección de gases y deduplicación natural.
 */
export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const now = new Date().toISOString();
    
    // 1. Extraer y normalizar datos de la IA
    const extData = aiData.extracted_data || {};
    const invoice = extData.invoice || {};
    const totalObj = extData.total_amount || {};
    const vendor = extData.vendor || {};
    const invoiceDate = invoice.date || "0000-00-00";

    // 2. Lógica de Deduplicación: Generación de la SK Natural (Vendor + Factura)
    const vendorClean = (vendor.name || "UNKNOWN").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const numberClean = (invoice.number || "NONUM").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const SK = `INV#${vendorClean}#${numberClean}`;

    // 3. Cálculos de Consumo (Suma de todas las líneas de emisión)
    const totalValue = aiData.emission_lines?.reduce((acc, line) => {
        return acc + Number(line.value || 0);
    }, 0) || 0;

    const displayUnit = aiData.emission_lines?.[0]?.unit || "kWh";

    // 4. Lógica de Huella de Carbono y Gases con Fallback
    const gases = footprint.constituent_gases || {};
    const totalCo2e = Number(footprint.total_kg || footprint.co2e || 0);

    // Si co2 viene nulo/0 pero hay un total equivalente, usamos el total como co2
    const co2SafeValue = (gases.co2 && gases.co2 > 0) ? gases.co2 : totalCo2e;

    // 5. Sanitización de Monto Económico
    const rawTotalAmount = totalObj.total || 0;
    const cleanAmount = typeof rawTotalAmount === 'string' 
        ? parseFloat(rawTotalAmount.replace(/[^0-9.,]/g, '').replace(',', '.')) 
        : Number(rawTotalAmount);

    const confidence = Number(aiData.confidence_score || 0);

    // 6. Construcción del Objeto Final (Esquema Single Table)
    return {
        PK: partitionKey,
        SK: SK,

        // Metadatos de Auditoría e IA
        ai_analysis: {
            activity_id: footprint.activity_id || "unknown",
            calculation_method: "consumption_based",
            confidence_score: confidence,
            insight_text: aiData.analysis_summary || `Processed invoice from ${vendor.name}`,
            requires_review: (confidence < 0.8),
            service_type: (aiData.category || "ELEC").toUpperCase(),
            unit: displayUnit,
            value: totalValue, // Refleja la suma real (ej. 220 kWh)
            year: invoiceDate.split('-')[0]
        },

        // Dimensiones para analítica y filtros en el Dashboard
        analytics_dimensions: {
            period_month: parseInt(invoiceDate.split('-')[1]) || 0,
            period_year: parseInt(invoiceDate.split('-')[0]) || 0,
            sector: "COMMERCIAL"
        },

        // Resultado Climatiq con desglose de gases protegidos
        climatiq_result: {
            co2e: totalCo2e,
            co2: Number(co2SafeValue),
            ch4: Number(gases.ch4 || 0),
            n2o: Number(gases.n2o || 0),
            co2e_unit: "kg",
            timestamp: now
        },

        // Datos extraídos para visualización en tablas de transacciones
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

        // Trazabilidad del archivo físico en S3
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