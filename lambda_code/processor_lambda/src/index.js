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
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            console.log(`[PROCESSING]: Org: ${orgId} | File: ${filename}`);

            // 2. OCR
            const rawOcr = await extraerFactura(bucket, key);
            
            // 3. Integridad (Hash)
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // 4. IA + CLIMATIQ 
            // IMPORTANTE: Esta función ahora siempre devuelve un objeto con { total_co2e, items, invoice_metadata }
            const climatiqResult = await calculateInClimatiq(rawOcr.summary, rawOcr.query_hints);

            // 5. Construcción del "Golden Record" 
            // Pasamos climatiqResult.invoice_metadata en lugar de audit
            const recordToSave = buildGoldenRecord(
                orgId, 
                fileId, 
                key, 
                filename, 
                fileHash, 
                climatiqResult.invoice_metadata || {}, 
                climatiqResult               
            );

            // 6. Lógica Defensiva Refactorizada
            // Si no hay total_co2e o no hay items, lo marcamos para revisión
            if (!climatiqResult || climatiqResult.total_co2e === 0) {
                console.warn(`[!] Marking ${fileId} for manual review: No carbon data found.`);
                recordToSave.status = "PENDING_REVIEW";
                recordToSave.error_log = "IA could not extract emission lines or calculation resulted in 0.";
            } else {
                recordToSave.status = "PROCESSED";
                // FIX DEL LOG: Usamos las propiedades correctas del objeto de respuesta
                const unit = (climatiqResult.items && climatiqResult.items.length > 0) 
                             ? climatiqResult.items[0].unit 
                             : 'kg';
                console.log(`✅ [CALCULATED]: ${climatiqResult.total_co2e.toFixed(5)} ${unit} CO2e`);
            }

            // 7. Persistencia
            await saveInvoiceWithStats(recordToSave);
            
            results.push({ 
                key, 
                status: 'success', 
                co2e: climatiqResult.total_co2e 
            });

        } catch (err) {
            console.error(`❌ [FATAL_ERROR] ${key}: ${err.stack}`); // Usamos .stack para ver la línea exacta del reduce
            results.push({ key, status: 'error', message: err.message });
        }
    }
    
    console.log(`=== [END_BATCH] Req: ${requestId} ===`);
    return results;
};