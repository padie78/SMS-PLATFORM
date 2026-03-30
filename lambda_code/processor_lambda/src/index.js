const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { extraerFactura } = require("./textract");
const { calculateInClimatiq } = require("./external_api");
const { saveInvoiceWithStats } = require("./db");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

// Configuración de Clientes AWS
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

/**
 * LAMBDA HANDLER: Orquestador Principal del Pipeline de Carbono
 * Flujo: S3 Trigger -> Textract (OCR) -> Bedrock (AI) -> Climatiq (CO2e) -> DynamoDB/RDS
 */
exports.handler = async (event, context) => {
    const results = [];
    const requestId = context.awsRequestId;

    console.log(`=== [START_BATCH] Req: ${requestId} | Records: ${event.Records.length} ===`);

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        try {
            // 1. Parsing de Metadatos del Path (Estructura: invoices/orgId/file.pdf)
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            console.log(`[PROCESSING]: Org: ${orgId} | File: ${filename}`);

            // 2. OCR - Extracción de texto bruto con AWS Textract
            // Retorna { summary, query_hints }
            const rawOcr = await extraerFactura(bucket, key);
            
            // 3. Integridad - Hash SHA256 para evitar duplicados y auditoría
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // 4. IA + CLIMATIQ - Clasificación y Cálculo Modular
            // Este método interno en external_api.js ya llama a Bedrock para clasificar
            // y luego a Climatiq para estimar el CO2e.
            const climatiqResult = await calculateInClimatiq(rawOcr.summary, rawOcr.query_hints);

            // 5. Construcción del "Golden Record" (Objeto consolidado para la DB)
            const recordToSave = buildGoldenRecord(
                orgId, 
                fileId, 
                key, 
                filename, 
                fileHash, 
                climatiqResult?.audit || {}, // Datos de auditoría de la IA (vendor, year, region)
                climatiqResult               // Resultado del cálculo (co2e, unit, strategy)
            );

            // 6. Lógica Defensiva: Manejo de Fallos de Cálculo
            if (!climatiqResult) {
                console.warn(`[!] Marking ${fileId} for manual review: Calculation or Classification failed.`);
                
                // Enriquecemos el registro para que el frontend sepa que requiere atención
                recordToSave.status = "PENDING_REVIEW";
                recordToSave.error_log = "IA could not confidently classify the invoice or Climatiq API timeout.";
            } else {
                recordToSave.status = "PROCESSED";
                console.log(`✅ [CALCULATED]: ${climatiqResult.co2e} ${climatiqResult.unit} CO2e`);
            }

            // 7. Persistencia Final
            await saveInvoiceWithStats(recordToSave);
            
            console.log(`✅ [SUCCESS]: ${key} saved to database.`);
            results.push({ key, status: 'success', co2e: climatiqResult?.co2e });

        } catch (err) {
            // Error Fatal (S3 Down, Textract Fail, DB Connection Lost)
            console.error(`❌ [FATAL_ERROR] ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
            
            // En un entorno productivo, aquí podrías enviar a una DLQ (Dead Letter Queue)
        }
    }
    
    console.log(`=== [END_BATCH] Req: ${requestId} ===`);
    return results;
};