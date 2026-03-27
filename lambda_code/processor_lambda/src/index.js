const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calcularEnClimatiq } = require("./external_api");
const { saveInvoiceWithStats } = require("./database");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        try {
            // 1. Extraer Metadatos del Path (Multi-tenant)
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            // 2. Procesamiento de Archivo y OCR
            const fileBuffer = await downloadFromS3(bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            const rawOcr = await extraerFactura(bucket, key);
            
            // 3. Inteligencia y Cálculos
            const ai = await entenderConIA(rawOcr.summary, rawOcr.items);
            const climatiq = await calcularEnClimatiq(ai.ai_analysis) || {};

            // 4. Mapeo del Golden Record (Lógica de Negocio)
            const recordToSave = buildGoldenRecord(orgId, fileId, key, filename, fileHash, ai, climatiq);

            // 5. Persistencia Atómica (Factura + Stats)
            await saveInvoiceWithStats(recordToSave);

            console.log(`[SUCCESS] Org: ${orgId} | File: ${filename}`);
            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[ERROR] ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};