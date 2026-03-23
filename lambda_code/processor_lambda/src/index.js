const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

// Importación de módulos
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calcularEnClimatiq } = require("./external_api");

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        const parts = key.split('/');
        const orgId = parts[1] || 'UNKNOWN_ORG'; 
        const filename = parts[parts.length - 1];
        const fileId = filename.split('.')[0] || Date.now().toString();

        try {
            console.log(`[PIPELINE_START] Archivo: ${filename} | Org: ${orgId}`);

            // 1. Hash del archivo
            const s3Response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const chunks = [];
            for await (const chunk of s3Response.Body) { chunks.push(chunk); }
            const fileBuffer = Buffer.concat(chunks);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            console.log(`[S3_HASH_SUCCESS] Hash: ${fileHash.substring(0, 10)}...`);

            // 2. OCR - Textract
            console.log(`[STEP 1] Iniciando Textract para: ${key}`);
            const factura = await extraerFactura(bucket, key);
            
            // Logueamos el objeto crudo que sale de Textract
            console.log(`[DEBUG_OCR_DATA] Datos extraídos por Textract:`, JSON.stringify(factura, null, 2));

            // 3. IA - Bedrock
            console.log(`[STEP 2] Enviando a Bedrock (Claude 3.5 Haiku)`);
            const aiResponse = await entenderConIA(factura.summary, factura.items);
            
            // Logueamos la respuesta de la IA
            console.log(`[DEBUG_AI_RESPONSE] Respuesta de Bedrock:`, JSON.stringify(aiResponse, null, 2));

            const { extracted_data, ai_analysis } = aiResponse;

            // 4. Carbono - Climatiq
            console.log(`[STEP 3] Calculando huella en Climatiq para: ${ai_analysis.service_type}`);
            const climatiq_result = await calcularEnClimatiq(ai_analysis);
            console.log(`[DEBUG_CLIMATIQ_RESULT] Resultado Climatiq:`, JSON.stringify(climatiq_result, null, 2));

            const now = new Date().toISOString();
            const [datePart] = now.split('T');

            // 5. Métricas y Lógica
            const carbonIntensity = extracted_data.total_amount > 0 
                ? (climatiq_result.co2e / extracted_data.total_amount).toFixed(5) 
                : 0;

            const requiresReview = (ai_analysis.confidence_score || 0) < 0.85;

            // 6. Golden Record
            const itemToPersist = {
                PK: `ORG#${orgId}`,
                SK: `INV#${datePart}#${fileId}`,
                metadata: {
                    user_id: "system_lambda", 
                    upload_date: now,
                    filename: filename,
                    s3_key: key,
                    file_hash: fileHash,
                    status: "PROCESSED",
                    source_type: "S3_EVENT",
                    tags: parts.slice(2, -1) 
                },
                extracted_data: {
                    vendor: extracted_data.vendor || "Desconocido",
                    invoice_date: extracted_data.invoice_date || datePart,
                    total_amount: Number(extracted_data.total_amount) || 0,
                    currency: extracted_data.currency || "ARS",
                    due_date: extracted_data.due_date || null,
                    client_number: extracted_data.client_number || "N/A"
                },
                ai_analysis: {
                    model: "claude-3-5-haiku-20241022",
                    service_type: ai_analysis.service_type,
                    scope: ai_analysis.scope || 2,
                    suggested_query: ai_analysis.suggested_query,
                    consumption_value: Number(ai_analysis.consumption_value) || 0,
                    consumption_unit: ai_analysis.consumption_unit,
                    unit_price: ai_analysis.unit_price || 0,
                    is_estimated_reading: ai_analysis.is_estimated_reading || false,
                    confidence_score: ai_analysis.confidence_score,
                    requires_review: requiresReview,
                    insight_text: ai_analysis.insight_text
                },
                climatiq_result: {
                    calculation_id: climatiq_result.calculation_id,
                    co2e: Number(climatiq_result.co2e),
                    co2e_unit: "kg",
                    intensity_factor: climatiq_result.intensity_factor,
                    activity_id: climatiq_result.activity_id,
                    audit_trail: climatiq_result.audit_trail,
                    timestamp: now
                },
                analytics_dimensions: {
                    region: "LATAM",
                    country: "AR",
                    city: extracted_data.city || "CABA",
                    sector: "CONSTRUCTION",
                    carbon_intensity_per_currency: parseFloat(carbonIntensity),
                    period_year: parseInt(datePart.split('-')[0]),
                    period_month: parseInt(datePart.split('-')[1])
                }
            };

            // 7. Persistencia
            console.log(`[STEP 4] Persistiendo en DynamoDB...`);
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: itemToPersist
            }));

            console.log(`[PIPELINE_SUCCESS] Factura ${fileId} procesada. CO2: ${climatiq_result.co2e}kg`);
            results.push({ key, status: 'success' });

        } catch (err) {
            // Log de error detallado con stack trace
            console.error(`[PIPELINE_ERROR] Error crítico procesando ${key}:`);
            console.error(`Mensaje: ${err.message}`);
            console.error(`Stack: ${err.stack}`);
            
            // Logueamos el error específico si es de AWS
            if (err.$metadata) {
                console.error(`AWS Error Metadata:`, JSON.stringify(err.$metadata));
            }

            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};