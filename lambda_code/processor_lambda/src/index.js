const crypto = require("crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { extraerFactura } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { exploreFreeActivities } = require("./external_api"); // <--- Importamos el explorador
const { saveInvoiceWithStats } = require("./db");
const { downloadFromS3, buildGoldenRecord } = require("./utils");

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event, context) => {
    const requestId = context.awsRequestId;

    // --- OPCIÓN A: MODO EXPLORADOR ---
    // Si envías un evento manual como { "action": "explore", "query": "electricity" }
    if (event.action === "explore") {
        console.log(`=== [RUNNING_EXPLORER_MODE] Req: ${requestId} ===`);
        return await exploreFreeActivities(event.query || "");
    }

    // --- OPCIÓN B: MODO PROCESAMIENTO (S3 Events) ---
    const results = [];
    console.log(`=== [BATCH_START] Req: ${requestId} | Records: ${event.Records?.length || 0} ===`);

    // Podrías incluso listar factores antes de empezar el batch para tenerlos en logs
    // await exploreFreeActivities("electricity"); 

    for (const record of event.Records || []) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        try {
            console.log(`>>> [PROCESSING_FILE]: s3://${bucket}/${key}`);
            
            // ... (Resto de tus pasos de OCR, IA, etc.)
            
            // Ejemplo: usar el explorador para loguear qué factores hay disponibles para este caso
            // const hints = await exploreFreeActivities("gas natural"); 

            results.push({ key, status: 'success' });
        } catch (err) {
            console.error(`❌ [STEP_FATAL_ERROR] at ${key}: ${err.message}`);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    
    return results;
};