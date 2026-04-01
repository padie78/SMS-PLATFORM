// 1. Importaciones con sintaxis ESM
import { extractText } from "./services/textract.js";
import bedrock from "./services/bedrock.js";
import { calculateFootprint } from "./services/climatiq.js";
import mapper from "./utils/mapper.js";
import db from "./services/db.js";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

// 2. Exportación del handler de Lambda
export const handler = async (event, context) => {
    const startTime = Date.now();
    const record = event.Records[0];
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const requestId = context.awsRequestId || Math.random().toString(36).substring(7);

    console.log(`🚀 [PIPELINE_START] [ID:${requestId}]: Procesando s3://${bucket}/${key}`);

    try {
        // --- FASE 1: EXTRACCIÓN OCR (NUEVO MODELO SIN QUERIES) ---
        console.log(`   [1/5] [TEXTRACT_START]: Ejecutando OCR base...`);
        const ocrData = await extractText(bucket, key);
        console.log(`🔍 [OCR_DONE] | Caracteres extraídos: ${ocrData.rawText.length}`);

        // --- FASE 2: ANÁLISIS INTELIGENTE (BEDROCK) ---
        // Ahora Bedrock recibe el rawText y él mismo clasifica y extrae todo.
        console.log(`   [2/5] [BEDROCK_START]: Clasificando y extrayendo datos con IA...`);
        const aiAnalysis = await bedrock.analyzeInvoice(ocrData.rawText);
        
        console.log(`🤖 [AI_DONE] | Cat: ${aiAnalysis.category} | Vendor: ${aiAnalysis.extracted_data?.vendor?.name || 'N/A'} | Total: ${aiAnalysis.extracted_data?.amounts?.total || 0} ${aiAnalysis.extracted_data?.amounts?.currency || ''}`);

        // --- FASE 3: CÁLCULO DE HUELLA (CLIMATIQ) ---
        const emissionLines = aiAnalysis.emission_lines || [];
        console.log(`   [3/5] [CLIMATIQ_START]: Calculando CO2 para ${emissionLines.length} líneas...`);
        
        const emissionCalculations = await calculateFootprint(
            emissionLines, 
            aiAnalysis.extracted_data?.location?.country || "ES"
        );
        
        const totalCo2 = emissionCalculations.reduce((acc, curr) => acc + (curr.co2e || 0), 0);
        console.log(`🌍 [CLIMATIQ_DONE] | Total_CO2e: ${totalCo2.toFixed(4)} kg`);

        // --- FASE 4: MAPEO DE DATOS ---
        console.log(`   [4/5] [MAPPER_START]: Construyendo Golden Record...`);
        
        // Obtener metadatos de S3 (OrganizationID)
        const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
        const s3Head = await s3.send(headCommand);
        const organizationId = s3Head.Metadata?.['organization-id'] || 'UNKNOWN';

        const goldenRecord = mapper.buildGoldenRecord(
            `ORG#${organizationId}`, 
            key,
            aiAnalysis,
            emissionCalculations
        );

        console.log(`💾 [MAPPER_DONE] | SK: ${goldenRecord.SK} | Status: READY`);

        // --- FASE 5: PERSISTENCIA ---
        console.log(`   [5/5] [DB_START]: Guardando en DynamoDB...`);
        const dbResult = await db.persistTransaction(goldenRecord);
        
        const duration = (Date.now() - startTime) / 1000;
        console.log(`✅ [PIPELINE_END] [ID:${requestId}]: Éxito en ${duration}s.`);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: "Success", 
                category: aiAnalysis.category,
                sk: goldenRecord.SK, 
                duration: `${duration}s` 
            })
        };

    } catch (error) {
        const totalDuration = (Date.now() - startTime) / 1000;
        console.error(`❌ [PIPELINE_CRITICAL_FAILURE] [ID:${requestId}] tras ${totalDuration}s:`, error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message, requestId })
        };
    }
};