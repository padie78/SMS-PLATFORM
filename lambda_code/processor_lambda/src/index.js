const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");

// Importación de módulos de infraestructura y lógica
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calcularEnClimatiq } = require("./external_api");
const { saveInvoiceWithStats } = require("./db");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

// Inicialización de cliente (fuera del handler para reutilizar ejecución en Lambda)
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        // 1. Obtener y limpiar el KEY correctamente
        const bucket = record.s3.bucket.name;
        const rawKey = record.s3.object.key; 
        const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        
        try {
            const parts = key.split('/');
            const orgId = parts[1] || 'UNKNOWN_ORG';
            const filename = parts.pop();
            const fileId = filename.split('.')[0];

            // 2. OCR - Llamada corregida (Solo bucket y key)
            // No pases el s3Client aquí, la función extraerFactura ya tiene su propio textractClient
            const rawOcr = await extraerFactura(bucket, key);
            
            // 3. Descarga (aquí sí usas s3Client)
            const fileBuffer = await downloadFromS3(s3Client, bucket, key);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // ... (resto de tu lógica de IA y DB)
            const ai = await entenderConIA(rawOcr.summary, rawOcr.query_hints); // Cambiado a query_hints
            const climatiq = await calcularEnClimatiq(ai.ai_analysis) || {};

            const recordToSave = buildGoldenRecord(orgId, fileId, key, filename, fileHash, ai, climatiq);
            await saveInvoiceWithStats(recordToSave);

            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[ERROR] Falló el procesamiento de ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};