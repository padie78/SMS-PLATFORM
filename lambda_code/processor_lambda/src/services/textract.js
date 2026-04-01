export const extractText = async (bucket, key) => {
    console.log(`   [TEXTRACT_START]: OCR Crudo | s3://${bucket}/${key}`);

    const params = {
        Document: { S3Object: { Bucket: bucket, Name: key } },
        // Quitamos FeatureTypes: ["QUERIES"] para que sea solo OCR base
    };

    try {
        const command = new AnalyzeDocumentCommand(params); // O incluso DetectDocumentTextCommand que es más barato
        const response = await client.send(command);

        // Extraemos el texto línea por línea
        const rawText = response.Blocks
            .filter(block => block.BlockType === "LINE")
            .map(block => block.Text)
            .join("\n");

        console.log(`   [TEXTRACT_END]: OCR completado. Caracteres: ${rawText.length}`);

        return {
            rawText,
            queryHints: {}, // Lo mandamos vacío para no romper el resto del código
            category: "OTHERS"
        };

    } catch (error) {
        console.error(`   ❌ [TEXTRACT_ERROR]:`, error.message);
        throw error;
    }
};