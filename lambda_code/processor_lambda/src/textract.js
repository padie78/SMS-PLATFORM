const { 
    TextractClient, 
    StartExpenseAnalysisCommand, 
    GetExpenseAnalysisCommand 
} = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

/**
 * Servicio de extracción de facturas mediante AWS Textract (Asíncrono)
 * Optimizado para Expense Analysis con logging de trazabilidad.
 */
exports.extraerFactura = async (bucket, key) => {
    const startTime = Date.now();
    console.log(`=== [TEXTRACT_JOB_START] ===`);
    console.log(`Origen: s3://${bucket}/${key}`);

    try {
        const startCommand = new StartExpenseAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
        });
        
        const startResponse = await textractClient.send(startCommand);
        const jobId = startResponse.JobId;
        
        console.log(`Job ID asignado: ${jobId}`);

        let finished = false;
        let response;
        let attempts = 0;

        // --- POLLING LOOP ---
        while (!finished && attempts < 30) { 
            attempts++;
            // Espera de 2 segundos entre intentos
            await new Promise(r => setTimeout(r, 2000));

            const getCommand = new GetExpenseAnalysisCommand({ JobId: jobId });
            response = await textractClient.send(getCommand);

            console.log(`[TEXTRACT_POLLING] Intento ${attempts} | Estado: ${response.JobStatus}`);

            if (response.JobStatus === "SUCCEEDED") {
                finished = true;
            } else if (response.JobStatus === "FAILED") {
                throw new Error(`AWS Textract Job Failed: ${response.StatusMessage || "Unknown reason"}`);
            }
        }

        if (!finished) throw new Error(`Timeout tras ${attempts} intentos (aprox. 60s).`);

        const processTime = Date.now() - startTime;
        console.log(`=== [TEXTRACT_RESPONSE_RECEIVED] ===`);
        console.log(`Tiempo total de procesamiento: ${processTime}ms`);

        // 1. Extracción de texto completo (LINE) para el Summary de Bedrock
        // Textract Expense puede devolver bloques en 'Blocks' o dentro de 'ExpenseDocuments'
        const fullText = (response.Blocks || [])
            .filter(b => b.BlockType === "LINE")
            .map(b => b.Text)
            .join(" ");

        // 2. Extracción de campos clave (Hints) detectados por el modelo de IA de Textract
        const rawHints = {};
        const expenseDoc = response.ExpenseDocuments?.[0];
        
        if (expenseDoc?.SummaryFields) {
            expenseDoc.SummaryFields.forEach(f => {
                const type = f.Type?.Text || "UNKNOWN";
                const value = f.ValueDetection?.Text || "N/A";
                rawHints[type] = value;
            });
            
            console.log("Campos financieros detectados (Hints):", JSON.stringify(rawHints, null, 2));
        }

        const result = {
            summary: fullText.trim(),
            query_hints: {
                VENDOR: rawHints.VENDOR_NAME || rawHints.NAME || "UNKNOWN",
                TOTAL_AMOUNT: rawHints.TOTAL || rawHints.AMOUNT_DUE,
                CURRENCY: rawHints.CURRENCY || "ILS",
                INVOICE_DATE: rawHints.INVOICE_RECEIPT_DATE || rawHints.DATE,
                ACCOUNT_ID: rawHints.ACCOUNT_NUMBER || rawHints.CUSTOMER_NUMBER,
                RAW: rawHints // Mantenemos el objeto original para debug
            },
            metadata: { 
                pages: response.DocumentMetadata?.Pages, 
                jobId: jobId,
                latency_ms: processTime
            }
        };

        console.log(`✅ [TEXTRACT_SUCCESS] Páginas: ${result.metadata.pages} | Texto extraído: ${result.summary.length} caracteres.`);
        console.log(`=== [TEXTRACT_JOB_END] ===`);

        return result;

    } catch (error) {
        console.error(`🚨 [TEXTRACT_FATAL_ERROR]`);
        console.error(`Mensaje: ${error.message}`);
        if (error.name === 'UnsupportedDocumentFormat') {
            console.error("Detalle: El formato del archivo en S3 no es compatible con Textract.");
        }
        throw error;
    }
};