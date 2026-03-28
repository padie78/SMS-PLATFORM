const { 
    TextractClient, 
    StartExpenseAnalysisCommand, 
    GetExpenseAnalysisCommand 
} = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

/**
 * Procesa facturas en PDF, JPG, PNG o TIFF con reconstrucción de contexto para IA.
 */
exports.extraerFactura = async (bucket, key) => {
    const startTime = Date.now();
    const extension = key.split('.').pop().toLowerCase();
    
    console.log(`=== [TEXTRACT_JOB_START] ===`);
    console.log(`Archivo: s3://${bucket}/${key} | Formato: ${extension}`);

    try {
        // 1. Iniciar Análisis Asíncrono
        const startCommand = new StartExpenseAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
        });
        
        const startResponse = await textractClient.send(startCommand);
        const jobId = startResponse.JobId;
        console.log(`Job ID: ${jobId}`);

        // 2. Polling de Estado
        let finished = false;
        let response;
        let attempts = 0;

        while (!finished && attempts < 30) { 
            attempts++;
            await new Promise(r => setTimeout(r, 2000));
            const getCommand = new GetExpenseAnalysisCommand({ JobId: jobId });
            response = await textractClient.send(getCommand);
            
            if (response.JobStatus === "SUCCEEDED") {
                finished = true;
            } else if (response.JobStatus === "FAILED") {
                throw new Error(`Textract Failed: ${response.StatusMessage}`);
            }
            console.log(`[POLLING] Intento ${attempts}: ${response.JobStatus}`);
        }

        if (!finished) throw new Error("Timeout en Textract.");

        // 3. Procesamiento de Resultados
        const detailedLines = [];
        const rawHints = {};
        const textParts = [];
        const expenseDoc = response.ExpenseDocuments?.[0];

        if (expenseDoc) {
            // A. Extraer Campos de Resumen (Vendor, Total, Fecha)
            if (expenseDoc.SummaryFields) {
                expenseDoc.SummaryFields.forEach(f => {
                    const type = f.Type?.Text || "UNKNOWN";
                    const value = f.ValueDetection?.Text || "";
                    const label = f.LabelDetection?.Text || "";
                    
                    rawHints[type] = value;
                    
                    // Alimentamos el texto bruto para la IA
                    if (label) textParts.push(`${label}: ${value}`);
                    else if (value) textParts.push(value);
                });
            }

            // B. Extraer Tablas de Consumo (Crucial para kWh/m3)
            if (expenseDoc.LineItemGroups) {
                expenseDoc.LineItemGroups.forEach((group, gIdx) => {
                    group.LineItems?.forEach((item, iIdx) => {
                        const fields = item.LineItemExpenseFields?.map(f => {
                            const val = f.ValueDetection?.Text || "";
                            if (val) textParts.push(val); // Backup para fullText
                            return `${f.Type?.Text || 'ITEM'}: ${val}`;
                        }).join(" | ");
                        
                        if (fields) detailedLines.push(`[LINE_${gIdx}_${iIdx}]: ${fields}`);
                    });
                });
            }
        }

        // C. Capturar Bloques OCR Estándar (Si están disponibles)
        let fullText = "";
        if (response.Blocks && response.Blocks.length > 0) {
            fullText = response.Blocks
                .filter(b => b.BlockType === "LINE")
                .map(b => b.Text)
                .join(" | ");
        } else {
            // Reconstrucción desde Expense si Blocks es undefined
            fullText = textParts.join(" | ");
        }

        // 4. Consolidación del Payload para Bedrock
        const summaryForAI = `
        FORMAT: ${extension.toUpperCase()}
        DOCUMENT_RAW_TEXT: ${fullText}
        STRUCTURED_LINE_ITEMS: 
        ${detailedLines.join("\n")}
        `.trim();

        const result = {
            summary: summaryForAI,
            query_hints: {
                VENDOR: rawHints.VENDOR_NAME || rawHints.NAME || "UNKNOWN",
                TOTAL_AMOUNT: rawHints.TOTAL || rawHints.AMOUNT_DUE || "0",
                CURRENCY: rawHints.CURRENCY || "EUR", // Default a EUR para SMS-Europe
                INVOICE_DATE: rawHints.INVOICE_RECEIPT_DATE || rawHints.DATE || null,
                ACCOUNT_ID: rawHints.ACCOUNT_NUMBER || "N/A",
                RAW: rawHints 
            },
            metadata: { 
                pages: response.DocumentMetadata?.Pages || 1, 
                jobId: jobId,
                format: extension,
                latency_ms: Date.now() - startTime
            }
        };

        console.log(`✅ [TEXTRACT_SUCCESS] Caracteres: ${result.summary.length} | Latencia: ${result.metadata.latency_ms}ms`);
        return result;

    } catch (error) {
        console.error(`🚨 [TEXTRACT_ERROR]`, error.message);
        throw error;
    }
};