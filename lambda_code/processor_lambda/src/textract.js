const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");

const client = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.extraerTexto = async (bucket, key) => {
    try {
        const command = new DetectDocumentTextCommand({
            DocumentLocation: {
                S3Object: {
                    Bucket: bucket,
                    Name: key
                }
            }
        });

        const response = await client.send(command);
        
        const texto = response.Blocks
            .filter(b => b.BlockType === "LINE")
            .map(b => b.Text)
            .join(" ");

        if (!texto || texto.trim().length === 0) {
            throw new Error("Textract no pudo extraer texto legible del documento.");
        }
        
        return texto;
    } catch (error) {
        console.error("Error en Textract:", error);
        throw error;
    }
};