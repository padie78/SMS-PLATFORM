const { 
    TextractClient, 
    StartExpenseAnalysisCommand, 
    GetExpenseAnalysisCommand 
} = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

/**
 * Procesa facturas mediante StartExpenseAnalysis (Asíncrono).
 * Ideal para PDFs de varias páginas que fallan en el modo síncrono.
 */
exports.extraerFactura = async (bucket, key) => {
    console.log(`[TEXTRACT] Iniciando flujo asíncrono para s3://${bucket}/${key}`);

    try {
        // 1. DISPARAR EL ANÁLISIS
        const startCommand = new StartExpenseAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
        });
        const { JobId } = await textractClient.send(startCommand);
        console.log(`[TEXTRACT] JobId generado: ${JobId}`);

        // 2. POLLING (Espera activa)
        // Las facturas de 3 páginas suelen tardar entre 3 y 8 segundos.
        let finished = false;
        let response;
        let attempts = 0;
        const maxAttempts = 20; 

        while (!finished && attempts < maxAttempts) {
            attempts++;
            // Esperamos 2 segundos entre intentos para no saturar el API
            await new Promise(resolve => setTimeout(resolve, 2000));

            const getCommand = new GetExpenseAnalysisCommand({ JobId });
            response = await textractClient.send(getCommand);

            console.log(`[TEXTRACT] Estado del Job: ${response.JobStatus} (Intento ${attempts})`);

            if (response.JobStatus === "SUCCEEDED") {
                finished = true;
            } else if (response.JobStatus === "FAILED") {
                throw new Error(`Textract Job ${JobId} failed: ${response.StatusMessage}`);
            }
        }

        if (!finished) {
            throw new Error("Timeout: Textract tardó demasiado en procesar el documento.");
        }

        // 3. PROCESAR RESULTADOS (Igual que tu lógica anterior)
        // Nota: GetExpenseAnalysis devuelve los bloques de texto en 'Blocks'
        const fullText = (response.Blocks || [])
            .filter(b => b.BlockType === "LINE")
            .map(b => b.Text)
            .join(" ");

        const expenseDoc = response.ExpenseDocuments?.[0];
        const rawHints = {};

        if (expenseDoc?.SummaryFields) {
            expenseDoc.SummaryFields.forEach(field => {
                const label = field.Type?.Text || "UNKNOWN";
                const value = field.ValueDetection?.Text || null;
                rawHints[label] = value;
            });
        }

        // Mantenemos tus query_hints originales para Bedrock
        const query_hints = {
            VENDOR: rawHints.VENDOR_NAME || rawHints.NAME,
            TOTAL_AMOUNT: rawHints.TOTAL || rawHints.AMOUNT_DUE,
            CURRENCY: rawHints.CURRENCY || null,
            INVOICE_DATE: rawHints.INVOICE_RECEIPT_DATE || rawHints.DATE,
            INVOICE_NUMBER: rawHints.INVOICE_RECEIPT_ID,
            ACCOUNT_ID: rawHints.ACCOUNT_NUMBER || rawHints.CUSTOMER_NUMBER,
            ADDRESS: rawHints.VENDOR_ADDRESS || rawHints.RECEIVER_ADDRESS,
            RAW_HINTS: rawHints
        };

        return {
            summary: fullText.trim(),
            query_hints: query_hints,
            metadata: {
                pages: response.DocumentMetadata?.Pages || 0,
                method: "StartExpenseAnalysis",
                jobId: JobId
            }
        };

    } catch (error) {
        console.error("[TEXTRACT_CRITICAL_ERROR]:", error.message);
        throw error;
    }
};