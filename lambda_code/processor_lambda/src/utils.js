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
    const [datePart, timePart] = now.split('T'); // Separamos fecha y hora
    
    const year = datePart.split('-')[0];
    const month = datePart.split('-')[1];

    // FIX 1: Mapeo correcto desde climatiq.total_co2e
    const co2e = Number(climatiq?.total_co2e) || 0;
    const amount = Number(ai.extracted_data?.total_amount) || 0;
    const serviceType = ai.ai_analysis?.service_type || "Unknown";
    const confidence = Number(ai.ai_analysis?.confidence_score) || 0;

    // FIX 2: SK con colisión cero para desarrollo. 
    // Agregamos los segundos del TimePart para que cada intento sea nuevo.
    const timeHash = timePart.replace(/:/g, '').split('.')[0]; 
    const sk = `INV#${datePart}#${fileHash.substring(0, 8)}#${timeHash}`;

    return {
        // Estructura para que db.js haga el reduce sin explotar
        internal_refs: {
            orgId,
            year,
            month,
            totalAmount: amount,
            items: climatiq?.items || [] // <--- IMPORTANTE para el reduce en db.js
        },
        full_record: {
            PK: `ORG#${orgId}`,
            SK: sk, 
            metadata: { 
                filename, 
                s3_key: key, 
                file_hash: fileHash, 
                upload_date: now, 
                status: "PROCESSED"
            },
            extracted_data: { 
                ...ai.extracted_data, 
                total_amount: amount,
                currency: ai.extracted_data?.currency || "EUR"
            },
            climatiq_result: { 
                ...climatiq, 
                total_co2e: co2e, // Normalizado
                timestamp: now
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