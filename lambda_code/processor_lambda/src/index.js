const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calculateInClimatiq } = require("./external_api");
const { saveInvoiceWithStats } = require("./db");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        try {
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            // 1. OCR Extraction
            const rawOcr = await extraerFactura(bucket, key);
            
            // 2. File Metadata
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // 3. AI Analysis (Semantic Understanding)
            // EntenderConIA now returns the structured object for both DB and Climatiq
            const aiAnalysis = await entenderConIA(rawOcr.summary, rawOcr.query_hints);

            // 4. Carbon Calculation
            // We pass the raw summary so Climatiq wrapper can perform its own semantic search
            const climatiqResult = await calculateInClimatiq(rawOcr.summary) || {};

            // 5. Persistence
            const recordToSave = buildGoldenRecord(orgId, fileId, key, filename, fileHash, aiAnalysis, climatiqResult);
            await saveInvoiceWithStats(recordToSave);

            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[ERROR] Processing failed for ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};