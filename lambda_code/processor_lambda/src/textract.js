const { TextractClient, AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");

const textractClient = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.extraerFactura = async (bucket, key) => {
    // 1. Validación de extensión rápida
    const extension = key.split('.').pop().toLowerCase();
    const validExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'tiff'];
    
    if (!validExtensions.includes(extension)) {
        throw new Error(`Unsupported document format: .${extension}. AWS Textract only supports PDF, JPG, PNG, and TIFF.`);
    }

    console.log(`[TEXTRACT] Procesando archivo .${extension} en s3://${bucket}/${key}`);
    
    const params = {
        Document: { S3Object: { Bucket: bucket, Name: key } },
        FeatureTypes: ["QUERIES", "FORMS"], 
        QueriesConfig: {
            Queries: [
                { Text: "What is the vendor or company name?", Alias: "VENDOR" },
                { Text: "What is the total amount to pay?", Alias: "TOTAL_AMOUNT" },
                { Text: "What is the currency (code or symbol)?", Alias: "CURRENCY" },
                { Text: "What is the invoice or document number?", Alias: "INVOICE_NUMBER" },
                { Text: "What is the invoice date?", Alias: "INVOICE_DATE" },
                { Text: "What is the service period start date?", Alias: "PERIOD_START" },
                { Text: "What is the service period end date?", Alias: "PERIOD_END" },
                { Text: "What is the total consumption value and unit (e.g. 500 kWh, 15 m3)?", Alias: "CONSUMPTION" },
                { Text: "What is the service address or installation site?", Alias: "SITE_LOCATION" },
                { Text: "What is the meter number or account identifier?", Alias: "ACCOUNT_ID" }
            ]
        }
    };

    try {
        const command = new AnalyzeDocumentCommand(params);
        const response = await textractClient.send(command);

        // Si el documento tiene muchas páginas, avisar en logs (AnalyzeDocument solo ve la pág 1)
        if (response.DocumentMetadata.Pages > 1) {
            console.warn(`[TEXTRACT_WARNING] Document has ${response.DocumentMetadata.Pages} pages. Synchronous API only processed the first page.`);
        }

        const fullText = response.Blocks
            .filter(b => b.BlockType === "LINE")
            .map(b => b.Text)
            .join(" ");

        const queryResults = {};
        const queryBlocks = response.Blocks.filter(b => b.BlockType === "QUERY");
        
        queryBlocks.forEach(q => {
            const relationship = q.Relationships?.find(r => r.Type === "ANSWER");
            if (relationship && relationship.Ids) {
                // Mejora: Buscar la respuesta de forma segura
                const answerId = relationship.Ids[0];
                const answerBlock = response.Blocks.find(b => b.Id === answerId);
                queryResults[q.Query.Alias] = answerBlock ? answerBlock.Text.trim() : null;
            } else {
                queryResults[q.Query.Alias] = null;
            }
        });

        return {
            summary: fullText.trim(),
            query_hints: queryResults,
            metadata: {
                pages: response.DocumentMetadata.Pages,
                format: extension
            }
        };

    } catch (error) {
        // Capturamos el error específico de AWS para dar feedback claro
        if (error.name === "UnsupportedDocumentException") {
            console.error("[TEXTRACT_CRITICAL] El archivo está corrupto o es un PDF no compatible.");
        }
        throw error;
    }
};