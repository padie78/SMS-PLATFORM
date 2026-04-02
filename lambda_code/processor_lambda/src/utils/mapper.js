import crypto from 'crypto';

export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const now = new Date().toISOString();
    
    // Extraer datos para la Sort Key
    const invoiceDate = aiData.extracted_data?.invoice?.date || "0000-00-00";
    const s3FileName = s3Key.split('/').pop();
    
    const fileHash = crypto.createHash('sha256').update(s3FileName).digest('hex');
    const shortHash = fileHash.substring(0, 8);
    const SK = `INV#${invoiceDate}#${shortHash}`;

    // Sanitización de montos (amounts.total según el log)
    const rawAmount = aiData.extracted_data?.invoice?.amounts?.total || 0;
    const cleanAmount = typeof rawAmount === 'string' 
        ? parseFloat(rawAmount.replace(/[^0-9.,]/g, '').replace(',', '.')) 
        : Number(rawAmount);

    return {
        PK: partitionKey,
        SK: SK,

        ai_analysis: {
            activity_id: footprint.activity_id,
            calculation_method: "consumption_based",
            // Corregido: toFixed fallaba porque esto venía undefined en tu log
            confidence_score: Number(aiData.confidence_score || 0), 
            insight_text: aiData.analysis_summary || `Processed invoice for ${aiData.extracted_data?.vendor?.name}`,
            parameter_type: "energy",
            region: aiData.extracted_data?.location?.country_code || "ES",
            requires_review: (Number(aiData.confidence_score || 0) < 0.8),
            service_type: aiData.category || "elec",
            unit: aiData.extracted_data?.consumption?.unit || "kWh",
            value: Number(aiData.extracted_data?.consumption?.value || 0),
            year: invoiceDate.split('-')[0]
        },

        analytics_dimensions: {
            carbon_intensity: footprint.carbon_intensity || 0,
            period_month: parseInt(invoiceDate.split('-')[1]) || 0,
            period_year: parseInt(invoiceDate.split('-')[0]) || 0,
            sector: "COMMERCIAL" 
        },

        climatiq_result: {
            activity_id: footprint.activity_id,
            audit_trail: "climatiq_elec_consumption_based",
            co2e: Number(footprint.total_kg || 0),
            co2e_unit: "kg",
            timestamp: now
        },

        extracted_data: {
            billing_period: {
                start: aiData.extracted_data?.invoice?.period_start || null,
                end: aiData.extracted_data?.invoice?.period_end || null
            },
            currency: aiData.extracted_data?.invoice?.currency || "EUR",
            invoice_date: invoiceDate,
            invoice_number: aiData.extracted_data?.invoice?.number || "NO-NUMBER",
            // RUTA CORREGIDA AQUÍ
            total_amount: cleanAmount || 0, 
            vendor: aiData.extracted_data?.vendor?.name || "Unknown Vendor"
        },

        metadata: {
            filename: s3FileName,
            file_hash: fileHash,
            s3_key: s3Key,
            source: "SYSTEM_PIPELINE",
            status: "PROCESSED",
            upload_date: now
        }
    };
};