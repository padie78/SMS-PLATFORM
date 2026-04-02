import crypto from 'crypto';

/**
 * Convierte la respuesta de Bedrock y los metadatos de S3/Footprint
 * en un Golden Record listo para DynamoDB Single-Table Design.
 */
export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const now = new Date().toISOString();
    
    // 1. Mapeo de rutas según el log [FULL_AI_RESPONSE]
    // Estructura detectada: aiData.extracted_data -> { invoice, total_amount, vendor }
    const extData = aiData.extracted_data || {};
    const invoice = extData.invoice || {};
    const totalObj = extData.total_amount || {};
    const vendor = extData.vendor || {};

    // 2. Preparación de Identificadores (Sort Key)
    const invoiceDate = invoice.date || "0000-00-00";
    const s3FileName = s3Key.split('/').pop();
    const fileHash = crypto.createHash('sha256').update(s3FileName).digest('hex');
    const shortHash = fileHash.substring(0, 8);
    
    // SK: INV#2023-01-16#abc12345
    const SK = `INV#${invoiceDate}#${shortHash}`;

    // 3. Extracción y Sanitización del Gasto (Total Amount)
    // Buscamos 'total' dentro del objeto 'total_amount' que devolvió la IA
    const rawTotal = totalObj.total || 0;
    const cleanAmount = typeof rawTotal === 'string' 
        ? parseFloat(rawTotal.replace(/[^0-9.,]/g, '').replace(',', '.')) 
        : Number(rawTotal);

    // 4. Construcción del Objeto Final
    return {
        PK: partitionKey,
        SK: SK,

        // BLOQUE: ANÁLISIS IA (Para la lógica de confianza y auditoría)
        ai_analysis: {
            activity_id: footprint.activity_id,
            calculation_method: "consumption_based",
            confidence_score: Number(aiData.confidence_score || 0.95), 
            insight_text: aiData.analysis_summary || `Processed invoice for ${vendor.name}`,
            parameter_type: "energy",
            region: extData.location?.country || "ES",
            requires_review: (Number(aiData.confidence_score || 0) < 0.8),
            service_type: (aiData.category || "ELEC").toUpperCase(),
            // Tomamos la unidad de la primera línea de emisión si existe
            unit: aiData.emission_lines?.[0]?.unit || "kWh",
            value: Number(aiData.emission_lines?.[0]?.value || 0),
            year: invoiceDate.split('-')[0]
        },

        // BLOQUE: DIMENSIONES ANALÍTICAS (Para filtros rápidos en el Dashboard)
        analytics_dimensions: {
            carbon_intensity: footprint.carbon_intensity || 0,
            period_month: parseInt(invoiceDate.split('-')[1]) || 0,
            period_year: parseInt(invoiceDate.split('-')[0]) || 0,
            sector: "COMMERCIAL" 
        },

        // BLOQUE: RESULTADO CLIMATIQ (Huella calculada)
        climatiq_result: {
            activity_id: footprint.activity_id,
            audit_trail: "climatiq_elec_consumption_based",
            co2e: Number(footprint.total_kg || 0),
            co2e_unit: "kg",
            timestamp: now
        },

        // BLOQUE: DATOS EXTRAÍDOS (Lo que se ve en la UI de la transacción)
        extracted_data: {
            billing_period: {
                // Si la IA añade period_start/end en el futuro
                start: invoice.period_start || null,
                end: invoice.period_end || null
            },
            currency: totalObj.currency || "EUR",
            invoice_date: invoiceDate,
            invoice_number: invoice.number || "NO-NUMBER",
            total_amount: isNaN(cleanAmount) ? 0 : cleanAmount, // <--- AQUÍ ESTÁ EL FIX
            vendor: vendor.name || "Unknown Vendor"
        },

        // BLOQUE: METADATOS TÉCNICOS
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

// Exportación por defecto para consistencia con el resto de tu arquitectura
export default { buildGoldenRecord };