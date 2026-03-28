const { GetObjectCommand } = require("@aws-sdk/client-s3");

/**
 * Limpia espacios y saltos de línea para un Summary limpio en Bedrock
 */
function limpiarTexto(texto) {
    if (!texto) return "";
    return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Validación robusta para Climatiq
 */
function validarCampos(datos) {
    // Verificamos que existan los 3 pilares del cálculo
    return !!(
        datos && 
        (datos.value || datos.consumption_value) && 
        (datos.unit || datos.consumption_unit) && 
        datos.activity_id
    );
}

/**
 * Helper optimizado para Node.js 18+ (AWS SDK v3)
 */
async function downloadFromS3(s3Client, bucket, key) {
    try {
        const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const byteArray = await response.Body.transformToByteArray();
        return Buffer.from(byteArray);
    } catch (error) {
        console.error(`🚨 [S3_DOWNLOAD_ERROR] Key: ${key}`, error);
        throw error;
    }
}

/**
 * Construye el objeto final para DynamoDB (Single Table Design)
 */
function buildGoldenRecord(orgId, fileId, key, filename, fileHash, ai, climatiq) {
    const now = new Date().toISOString();
    const [datePart] = now.split('T');
    
    const year = datePart.split('-')[0];
    const month = datePart.split('-')[1];

    // Normalización forzada de valores numéricos
    const co2e = Number(climatiq?.co2e) || 0;
    const amount = Number(ai.extracted_data?.total_amount) || 0;
    const serviceType = ai.ai_analysis?.service_type || "Unknown";
    const confidence = Number(ai.ai_analysis?.confidence_score) || 0;

    return {
        internal_refs: {
            orgId,
            year,
            month,
            co2e,
            totalAmount: amount,
            serviceType
        },
        full_record: {
            PK: `ORG#${orgId}`,
            // Usamos el fileHash en el SK para evitar colisiones si se procesa el mismo día
            SK: `INV#${datePart}#${fileHash.substring(0, 8)}`, 
            metadata: { 
                filename, 
                s3_key: key, 
                file_hash: fileHash, 
                upload_date: now, 
                status: "PROCESSED",
                source: "SYSTEM_PIPELINE"
            },
            extracted_data: { 
                ...ai.extracted_data, 
                total_amount: amount,
                currency: ai.extracted_data?.currency || "EUR" // Iberdrola default
            },
            ai_analysis: { 
                ...ai.ai_analysis, 
                confidence_score: confidence,
                requires_review: confidence < 0.80 // Umbral de negocio
            },
            climatiq_result: { 
                ...climatiq, 
                co2e, 
                timestamp: now,
                co2e_unit: "kg" 
            },
            analytics_dimensions: {
                period_year: parseInt(year),
                period_month: parseInt(month),
                // Evitamos división por cero y redondeamos
                carbon_intensity: amount > 0 ? Number((co2e / amount).toFixed(5)) : 0,
                sector: "CONSTRUCTION"
            }
        }
    };
}

module.exports = { 
    limpiarTexto, 
    validarCampos, 
    downloadFromS3, 
    buildGoldenRecord 
};