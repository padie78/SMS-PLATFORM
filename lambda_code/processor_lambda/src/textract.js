const { 
    TextractClient, 
    StartExpenseAnalysisCommand, 
    GetExpenseAnalysisCommand 
} = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.extraerFactura = async (bucket, key) => {
    const startTime = Date.now();
    const extension = key.split('.').pop().toLowerCase();
    
    console.log(`=== [TEXTRACT_JOB_START] ===`);
    console.log(`Archivo: s3://${bucket}/${key} | Formato: ${extension}`);

    try {
        const startCommand = new StartExpenseAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
        });
        
        const startResponse = await textractClient.send(startCommand);
        const jobId = startResponse.JobId;
        console.log(`Job ID: ${jobId}`);

        let finished = false;
        let response;
        let attempts = 0;

        while (!finished && attempts < 30) { 
            attempts++;
            await new Promise(r => setTimeout(r, 2000));
            const getCommand = new GetExpenseAnalysisCommand({ JobId: jobId });
            response = await textractClient.send(getCommand);
            
            if (response.JobStatus === "SUCCEEDED") finished = true;
            else if (response.JobStatus === "FAILED") throw new Error(`Textract Failed: ${response.StatusMessage}`);
            console.log(`[POLLING] Intento ${attempts}: ${response.JobStatus}`);
        }

        if (!finished) throw new Error("Timeout en Textract.");

        // --- 🔍 SECCIÓN DE LOGS DE EXTRACCIÓN DETALLADA ---
        console.log(`=== [TEXTRACT_RAW_DATA_INVENTORY] ===`);
        
        const detailedLines = [];
        const rawHints = {};
        const textParts = [];
        const expenseDoc = response.ExpenseDocuments?.[0];

        if (expenseDoc) {
            // 1. Log de Campos Globales (SummaryFields)
            if (expenseDoc.SummaryFields) {
                console.log(`--- [DETECCIÓN DE CAMPOS CABECERA] ---`);
                expenseDoc.SummaryFields.forEach(f => {
                    const type = f.Type?.Text || "UNKNOWN";
                    const value = f.ValueDetection?.Text || "";
                    const label = f.LabelDetection?.Text || "";
                    const confidence = f.Type?.Confidence?.toFixed(2) || "N/A";
                    
                    // Log individual de campo para debug
                    console.log(`[FIELD] ${type}: "${value}" (Label: ${label}) | Conf: ${confidence}%`);
                    
                    rawHints[type] = value;
                    if (label) textParts.push(`${label}: ${value}`);
                    else if (value) textParts.push(value);
                });
            }

            // 2. Log de Tablas y Líneas (LineItems)
            if (expenseDoc.LineItemGroups) {
                console.log(`--- [DETECCIÓN DE TABLAS/LÍNEAS] ---`);
                expenseDoc.LineItemGroups.forEach((group, gIdx) => {
                    group.LineItems?.forEach((item, iIdx) => {
                        const fields = item.LineItemExpenseFields?.map(f => {
                            const type = f.Type?.Text || 'ITEM';
                            const val = f.ValueDetection?.Text || "";
                            if (val) textParts.push(val);
                            return `${type}: ${val}`;
                        }).join(" | ");
                        
                        if (fields) {
                            console.log(`[TABLE_LINE] G:${gIdx} L:${iIdx} | ${fields}`);
                            detailedLines.push(`[LINE_${gIdx}_${iIdx}]: ${fields}`);
                        }
                    });
                });
            }
        }

        // 3. Capturar Bloques OCR Estándar (Si están disponibles en el response)
        let fullText = "";
        if (response.Blocks && response.Blocks.length > 0) {
            fullText = response.Blocks
                .filter(b => b.BlockType === "LINE")
                .map(b => b.Text)
                .join(" | ");
        } else {
            fullText = textParts.join(" | ");
        }

        // Log del texto consolidado que verá la IA
        console.log(`--- [FULL_TEXT_FOR_IA] ---`);
        console.log(fullText.substring(0, 1000) + (fullText.length > 1000 ? "... [TRUNCATED]" : ""));

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
                CURRENCY: rawHints.CURRENCY || "EUR",
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

        console.log(`✅ [TEXTRACT_SUCCESS] Caracteres: ${result.summary.length} | Items: ${detailedLines.length}`);
        return result;

    } catch (error) {
        console.error(`🚨 [TEXTRACT_ERROR]`, error.message);
        throw error;
    }
};