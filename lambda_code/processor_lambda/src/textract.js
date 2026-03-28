const { 
    TextractClient, 
    StartExpenseAnalysisCommand, 
    GetExpenseAnalysisCommand 
} = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

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

        while (!finished && attempts < 30) { 
            attempts++;
            await new Promise(r => setTimeout(r, 2000));
            const getCommand = new GetExpenseAnalysisCommand({ JobId: jobId });
            response = await textractClient.send(getCommand);
            console.log(`[TEXTRACT_POLLING] Intento ${attempts} | Estado: ${response.JobStatus}`);
            if (response.JobStatus === "SUCCEEDED") finished = true;
            else if (response.JobStatus === "FAILED") throw new Error(`AWS Textract Job Failed: ${response.StatusMessage}`);
        }

        if (!finished) throw new Error(`Timeout tras ${attempts} intentos.`);

        const processTime = Date.now() - startTime;
        console.log(`=== [TEXTRACT_RESPONSE_RECEIVED] ===`);

        // --- 1. EXTRACCIÓN DE TEXTO COMPLETO (Estrategia Híbrida) ---
        // Primero intentamos bloques directos (OCR puro)
        let fullText = (response.Blocks || [])
            .filter(b => b.BlockType === "LINE")
            .map(b => b.Text)
            .join(" | ");

        const detailedLines = [];
        const rawHints = {};
        const expenseDoc = response.ExpenseDocuments?.[0];

        if (expenseDoc) {
            // Extraer Hints financieros
            if (expenseDoc.SummaryFields) {
                expenseDoc.SummaryFields.forEach(f => {
                    rawHints[f.Type?.Text || "UNKNOWN"] = f.ValueDetection?.Text || "N/A";
                });
            }

            // PROCESAMIENTO DE TABLAS (Donde están los consumos: kWh, m3, etc.)
            if (expenseDoc.LineItemGroups) {
                expenseDoc.LineItemGroups.forEach(group => {
                    group.LineItems?.forEach(item => {
                        const line = item.LineItemExpenseFields
                            ?.map(f => `${f.Type?.Text || 'DESC'}: ${f.ValueDetection?.Text}`)
                            .join(" | ");
                        if (line) detailedLines.push(`[DETALLE_CONSUMO]: ${line}`);
                    });
                });
            }

            // SAFETY NET: Si fullText vino vacío (común en ExpenseAnalysis), reconstruimos 
            // el texto completo a partir de los campos detectados por el modelo de IA.
            if (!fullText) {
                console.log("[TEXTRACT_DEBUG] Reconstruyendo texto desde ExpenseDocuments...");
                const backupText = [];
                expenseDoc.SummaryFields?.forEach(f => backupText.push(f.LabelDetection?.Text, f.ValueDetection?.Text));
                fullText = backupText.filter(Boolean).join(" ");
            }
        }

        // --- 2. CONSOLIDACIÓN PARA BEDROCK ---
        const summaryForAI = `
        DOCUMENT_RAW_TEXT: ${fullText}
        STRUCTURED_LINE_ITEMS: ${detailedLines.join("\n")}
        `.trim();

        const result = {
            summary: summaryForAI,
            query_hints: {
                VENDOR: rawHints.VENDOR_NAME || rawHints.NAME || "UNKNOWN",
                TOTAL_AMOUNT: rawHints.TOTAL || rawHints.AMOUNT_DUE || "0",
                CURRENCY: rawHints.CURRENCY || "ILS",
                INVOICE_DATE: rawHints.INVOICE_RECEIPT_DATE || rawHints.DATE || null,
                ACCOUNT_ID: rawHints.ACCOUNT_NUMBER || rawHints.CUSTOMER_NUMBER || "N/A",
                RAW: rawHints 
            },
            metadata: { 
                pages: response.DocumentMetadata?.Pages || 1, 
                jobId: jobId,
                latency_ms: processTime
            }
        };

        // El log crítico para debuguear el summaryLength
        console.log(`✅ [TEXTRACT_SUCCESS] Páginas: ${result.metadata.pages} | Caracteres Summary: ${result.summary.length}`);
        console.log(`=== [TEXTRACT_JOB_END] ===`);

        return result;

    } catch (error) {
        console.error(`🚨 [TEXTRACT_FATAL_ERROR]`, error.message);
        throw error;
    }
};