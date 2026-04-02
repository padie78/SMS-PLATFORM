import { extractText } from "./services/textract.js";
import bedrock from "./services/bedrock.js";
import { calculateFootprint } from "./services/climatiq.js";
import mapper from "./utils/mapper.js";
import db from "./services/db.js";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const handler = async (event, context) => {
    const startTime = Date.now();
    const record = event.Records[0];
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const requestId = context.awsRequestId;

    try {
        // --- FASE 1: OCR ---
        const ocrData = await extractText(bucket, key);

        // --- FASE 2: IA ANALYSIS ---
        const aiAnalysis = await bedrock.analyzeInvoice(ocrData.rawText);
        
        // --- FASE 3: CLIMATIQ CALCULATION ---
        // Inyectamos categoría global en las líneas si Bedrock la omitió
        const emissionLines = (aiAnalysis.emission_lines || []).map(line => ({
            ...line,
            category: line.category || aiAnalysis.category || "ELEC"
        }));

        const country = aiAnalysis.extracted_data?.location?.country || "ES";
        const emissionCalculations = await calculateFootprint(emissionLines, country);
        
        // Extraemos los valores del objeto retornado
        const totalCO2 = emissionCalculations.total_kg; 
        const resultsArray = emissionCalculations.items; // <-- Tu desglose para auditoría

        console.log(`🌍 [CLIMATIQ_DONE] | Total: ${totalCO2.toFixed(2)} kgCO2e | Líneas: ${resultsArray.length}`);

        // --- FASE 4: GOLDEN RECORD (MAPPER) ---
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const orgId = head.Metadata?.['organization-id'] || 'GENERIC_ORG';

        const goldenRecord = mapper.buildGoldenRecord(
            `ORG#${orgId}`, 
            key,
            aiAnalysis,
            emissionCalculations // Pasamos el objeto completo (total + items)
        );

        // --- FASE 5: DYNAMODB ---
        await db.persistTransaction(goldenRecord);
        
        return { statusCode: 200, body: JSON.stringify({ status: "SUCCESS", id: goldenRecord.SK }) };

    } catch (error) {
        console.error(`❌ [CRITICAL_FAILURE]:`, error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};