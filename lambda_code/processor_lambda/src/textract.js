const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

// Importación de tus módulos (deben estar en la misma carpeta o como Layers)
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calcularEnClimatiq } = require("./external_api");

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        // Extracción de contexto multi-tenant
        const parts = key.split('/');
        const orgId = parts[1] || 'UNKNOWN_ORG'; 
        const filename = parts[parts.length - 1];
        const fileId = filename.split('.')[0] || Date.now().toString();

        try {
            console.log(`[PIPELINE_START] Procesando: ${filename} para Org: ${orgId}`);

            // 1. Obtener Buffer y generar Hash para evitar duplicados futuros
            const s3Response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const chunks = [];
            for await (const chunk of s3Response.Body) { chunks.push(chunk); }
            const fileBuffer = Buffer.concat(chunks);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // 2. OCR - Textract (Ahora configurado para capturar Service Dates)
            const facturaRaw = await extraerFactura(bucket, key);
            
            // 3. IA - Bedrock (Con el nuevo System Prompt Blindado)
            const aiResponse = await entenderConIA(facturaRaw.summary, facturaRaw.items);
            const { extracted_data = {}, ai_analysis = {} } = aiResponse;

            // 4. Carbono - Climatiq (Llamada con los Enums normalizados)
            const climatiqResult = await calcularEnClimatiq(ai_analysis) || {};

            const now = new Date().toISOString();
            const [today] = now.split('T');

            // 5. Lógica de Negocio e Indicadores de Sostenibilidad
            const totalAmount = Number(extracted_data.total_amount) || 0;
            const co2Value = Number(climatiqResult.co2e) || 0;
            
            // Métrica Pro: Intensidad de Carbono (CO2 por cada unidad monetaria)
            const carbonIntensity = totalAmount > 0 ? (co2Value / totalAmount).toFixed(5) : 0;

            // 6. Construcción del "Golden Record" para DynamoDB
            const itemToPersist = {
                PK: `ORG#${orgId}`,
                SK: `INV#${extracted_data.invoice_date || today}#${fileId}`,
                metadata: {
                    filename,
                    s3_key: key,
                    file_hash: fileHash,
                    processed_at: now,
                    status: "PROCESSED",
                    ai_model: "claude-3-5-haiku-v2"
                },
                extracted_data: {
                    vendor: extracted_data.vendor || "UNKNOWN",
                    invoice_number: extracted_data.invoice_number || "N/A",
                    invoice_date: extracted_data.invoice_date || today,
                    period_start: extracted_data.period_start || null,
                    period_end: extracted_data.period_end || null,
                    total_amount: totalAmount,
                    currency: extracted_data.currency || "USD",
                    raw_consumption: extracted_data.raw_consumption || 0,
                    raw_unit: extracted_data.raw_unit || "unit"
                },
                ai_analysis: {
                    service_type: ai_analysis.service_type, // Enum: Electricity, Gas...
                    scope: ai_analysis.scope,               // Enum: 1, 2, 3
                    calculation_method: ai_analysis.calculation_method, // Enum: consumption_based, spend_based
                    activity_id: ai_analysis.activity_id,
                    parameter_type: ai_analysis.parameter_type,
                    value: Number(ai_analysis.value) || 0,
                    unit: ai_analysis.unit,
                    confidence_score: ai_analysis.confidence_score || 0,
                    requires_review: ai_analysis.requires_review || (ai_analysis.confidence_score < 0.85),
                    is_estimated_reading: !!ai_analysis.is_estimated_reading,
                    insight_text: ai_analysis.insight_text || ""
                },
                climatiq_result: {
                    co2e: co2Value,
                    co2e_unit: "kg",
                    activity_id: climatiqResult.activity_id || ai_analysis.activity_id,
                    calculation_id: climatiqResult.calculation_id || "N/A",
                    audit_trail: "climatiq_api_v3"
                },
                analytics_dimensions: {
                    period_year: parseInt((extracted_data.invoice_date || today).split('-')[0]),
                    period_month: parseInt((extracted_data.invoice_date || today).split('-')[1]),
                    carbon_intensity: parseFloat(carbonIntensity),
                    country: "AR", // Podría dinamizarse con extracted_data.country
                    sector: "CONSTRUCTION"
                }
            };

            // 7. Persistencia Final
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE || "EmissionsData",
                Item: itemToPersist
            }));

            console.log(`[PIPELINE_SUCCESS] Factura ${fileId} guardada con éxito.`);
            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[PIPELINE_ERROR] Fallo en ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};