const { TextractClient, AnalyzeExpenseCommand } = require("@aws-sdk/client-textract");

const client = new TextractClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.extraerFactura = async (bucket, key) => {
    try {
        const command = new AnalyzeExpenseCommand({
            DocumentLocation: {
                S3Object: {
                    Bucket: bucket,
                    Name: key
                }
            }
        });

        const response = await client.send(command);

        // AnalyzeExpense devuelve "ExpenseDocuments"
        const doc = response.ExpenseDocuments[0];

        // 1. Extraer Campos Resumen (Vendor, Total, Fecha, etc.)
        const summaryFields = {};
        doc.SummaryFields.forEach(field => {
            const type = field.Type.Text;
            const value = field.ValueDetection.Text;
            summaryFields[type] = value;
        });

        // 2. Extraer Ítems de Línea (Lo que vas a mandar a Bedrock/Climatiq)
        const lineItems = doc.LineItemGroups.flatMap(group => 
            group.LineItems.map(item => {
                const itemData = {};
                item.LineItemExpenseFields.forEach(f => {
                    itemData[f.Type.Text] = f.ValueDetection.Text;
                });
                return itemData;
            })
        );

        return {
            summary: summaryFields,
            items: lineItems,
            rawResponse: response // Útil para el Audit Trail que mencionamos
        };

    } catch (error) {
        console.error("Error en AnalyzeExpense:", error);
        throw error;
    }
};