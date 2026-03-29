const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calculateInClimatiq } = require("./external_api");
const { saveInvoiceWithStats } = require("./db");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

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

            // 1. OCR
            const rawOcr = await extraerFactura(bucket, key);
            
            // 2. Hash & Metadata
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // 3. IA - Entendimiento Semántico
            const aiAnalysis = await entenderConIA(rawOcr.summary, rawOcr.query_hints);

            // 4. Climatiq - Cálculo de Carbono
            const climatiqResult = await calculateInClimatiq(rawOcr.summary, rawOcr.query_hints);

            // 5. Persistencia con Lógica Defensiva Consolidada
            const recordToSave = buildGoldenRecord(orgId, fileId, key, filename, fileHash, aiAnalysis, climatiqResult || {});

            // Marcamos estado de error si Climatiq falló pero permitimos que se guarde para revisión manual
            if (!climatiqResult) {
                console.warn(`[!] Marking ${fileId} for manual review: Calculation failed.`);
                recordToSave.metadata = recordToSave.metadata || {};
                recordToSave.ai_analysis = recordToSave.ai_analysis || {};
                
                recordToSave.metadata.status = "FAILED_CALCULATION";
                recordToSave.ai_analysis.requires_review = true;
            }

            await saveInvoiceWithStats(recordToSave);
            
            console.log(`✅ [PROCESSED]: ${key}`);
            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`❌ [FATAL_ERROR] ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
            // Opcional: throw err; si quieres que la Lambda reintente vía SQS/EventBridge
        }
    }
    
    return results;
};