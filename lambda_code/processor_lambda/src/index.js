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

    console.log(`=== [START_BATCH_PROCESSING] RequestId: ${requestId} | Records: ${event.Records.length} ===`);

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        console.log(`--- [PROCESSING_FILE]: ${key} ---`);

        try {
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            // 1. OCR Extraction
            console.log(`[STEP 1/5] Running Textract OCR...`);
            const rawOcr = await extraerFactura(bucket, key);
            console.log(`[INFO] Textract Success. Characters: ${rawOcr.summary.length}`);
            
            // 2. File Metadata (Hash)
            console.log(`[STEP 2/5] Downloading from S3 for hashing...`);
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            console.log(`[INFO] File Hash: ${fileHash}`);

            // 3. AI Analysis (Semantic Understanding)
            console.log(`[STEP 3/5] Invoking Bedrock for Semantic Analysis...`);
            const aiAnalysis = await entenderConIA(rawOcr.summary, rawOcr.query_hints);
            console.log(`[INFO] AI identified Vendor: ${aiAnalysis.extracted_data?.vendor} | Service: ${aiAnalysis.ai_analysis?.service_type}`);

            // 4. Carbon Calculation (Dynamic Semantic Search)
            console.log(`[STEP 4/5] Executing Climatiq Semantic Flow...`);
            // Pasamos summary para que la API haga el Search -> Extraction -> Estimate
            const climatiqResult = await calculateInClimatiq(rawOcr.summary, rawOcr.query_hints);
            
            if (climatiqResult) {
                console.log(`[INFO] Climatiq Success: ${climatiqResult.co2e} ${climatiqResult.unit} CO2e`);
            } else {
                console.warn(`[WARNING] Climatiq returned null. Calculation failed for this factor.`);
            }

            // 5. Persistence
            console.log(`[STEP 5/5] Saving Golden Record and Stats to DB...`);
            // Usamos un objeto vacío como fallback para climatiqResult si falló, pero el record marcará el error
            const recordToSave = buildGoldenRecord(orgId, fileId, key, filename, fileHash, aiAnalysis, climatiqResult || {});
            
            // Inyectamos estado manual si el cálculo falló
            if (!climatiqResult) {
                recordToSave.metadata.status = "FAILED_CALCULATION";
                recordToSave.ai_analysis.requires_review = true;
            }

            await saveInvoiceWithStats(recordToSave);
            console.log(`✅ [SUCCESS] Finished processing: ${key}`);

            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`❌ [ERROR] Processing failed for ${key}: ${err.message}`);
            console.error(err.stack);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    
    console.log(`=== [BATCH_COMPLETE] Success: ${results.filter(r => r.status === 'success').length} | Errors: ${results.filter(r => r.status === 'error').length} ===`);
    return results;
};