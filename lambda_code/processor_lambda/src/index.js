const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");
// ... tus otros imports (extraerTexto, entenderConIA, calcularEnApiExterna)

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        const parts = key.split('/');
        const orgId = parts[1] || 'UNKNOWN_ORG'; 
        const filename = key.split('/').pop();
        const fileId = filename.split('.')[0] || Date.now().toString();

        try {
            console.log(`[START] Procesando ${filename} para ${orgId}`);

            // 1. Obtener el Buffer para calcular el Hash (Detección de duplicados)
            // Nota: Aquí necesitarías un GetObjectCommand de S3 para obtener el cuerpo del archivo
            const fileHash = crypto.createHash('sha256').update(key).digest('hex'); // Simplificado para el ejemplo

            // 2. OCR y Procesamiento de IA
            const texto = await extraerTexto(bucket, key);
            
            // entenderConIA devuelve: extracted_data, ai_analysis (con insight_text y confidence_score)
            const { extracted_data, ai_analysis } = await entenderConIA(texto);
            
            // 3. Cálculo de Carbono con Climatiq
            const climatiq_result = await calcularEnApiExterna(ai_analysis);

            const now = new Date().toISOString();
            const [datePart] = now.split('T');

            // 4. Lógica de Negocio y Análisis
            const carbonIntensity = extracted_data.total_amount > 0 
                ? (climatiq_result.co2e / extracted_data.total_amount).toFixed(5) 
                : 0;

            // Definimos el umbral de confianza (si es < 0.85, requiere revisión humana)
            const requiresReview = ai_analysis.confidence_score < 0.85;

            // 5. Construcción del Item Final (Golden Record)
            const itemToPersist = {
                PK: `ORG#${orgId}`,
                SK: `INV#${datePart}#${fileId}`,
                metadata: {
                    user_id: "u12345", // Idealmente sacado del contexto o metadata de S3
                    upload_date: now,
                    filename: filename,
                    s3_key: key,
                    file_hash: fileHash,
                    status: "PROCESSED",
                    source_type: "APP_UPLOAD",
                    tags: parts.slice(2, -1) // Toma años/meses de la ruta si existen
                },
                extracted_data: {
                    vendor: extracted_data.vendor,
                    invoice_date: extracted_data.invoice_date,
                    total_amount: extracted_data.total_amount,
                    currency: extracted_data.currency || "ARS",
                    due_date: extracted_data.due_date || null,
                    client_number: extracted_data.client_number || "N/A"
                },
                ai_analysis: {
                    model: "claude-3-haiku-20240307",
                    service_type: ai_analysis.service_type,
                    scope: ai_analysis.scope,
                    suggested_query: ai_analysis.suggested_query,
                    consumption_value: ai_analysis.consumption_value,
                    consumption_unit: ai_analysis.consumption_unit,
                    unit_price: ai_analysis.unit_price || (extracted_data.total_amount / ai_analysis.consumption_value).toFixed(2),
                    is_estimated_reading: ai_analysis.is_estimated_reading || false,
                    confidence_score: ai_analysis.confidence_score,
                    requires_review: requiresReview,
                    insight_text: ai_analysis.insight_text
                },
                climatiq_result: {
                    calculation_id: climatiq_result.calculation_id,
                    co2e: climatiq_result.co2e,
                    co2e_unit: "kg",
                    intensity_factor: climatiq_result.intensity_factor,
                    activity_id: climatiq_result.activity_id,
                    audit_trail: climatiq_result.audit_trail,
                    timestamp: now
                },
                analytics_dimensions: {
                    region: "LATAM",
                    country: "AR",
                    city: extracted_data.city || "CABA", // Si Bedrock lo extrae
                    sector: "CONSTRUCTION", // Podrías sacarlo del perfil de la Org
                    carbon_intensity_per_currency: parseFloat(carbonIntensity),
                    period_year: parseInt(datePart.split('-')[0]),
                    period_month: parseInt(datePart.split('-')[1])
                }
            };

            // 6. Persistencia
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: itemToPersist
            }));

            // Actualizar el puntero LATEST para el Dashboard
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: { 
                    ...itemToPersist, 
                    SK: `LATEST#METRIC` 
                }
            }));

            console.log(`[SUCCESS] Procesado: ${fileId} | CO2: ${climatiq_result.co2e}kg`);
            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[ERROR] Falló procesamiento de ${key}:`, err);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};