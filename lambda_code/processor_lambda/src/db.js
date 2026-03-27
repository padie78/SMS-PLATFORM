const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});

exports.saveInvoiceWithStats = async (item) => {
    const { orgId, year, month, serviceType, co2e, totalAmount } = item.internal_refs;
    
    const params = {
        TransactItems: [
            {
                // Registro Detallado de la Factura
                Put: {
                    TableName: process.env.DYNAMO_TABLE,
                    Item: item.full_record
                }
            },
            {
                // Actualización Atómica de Estadísticas Anuales
                Update: {
                    TableName: process.env.DYNAMO_TABLE,
                    Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                    UpdateExpression: `
                        ADD total_co2e_kg :co2, 
                            total_spend :money,
                            invoice_count :one,
                            by_month.#m.co2 :co2,
                            by_month.#m.spend :money,
                            by_service.#s :co2
                    `,
                    ExpressionAttributeNames: {
                        "#m": month,
                        "#s": serviceType
                    },
                    ExpressionAttributeValues: {
                        ":co2": co2e,
                        ":money": totalAmount,
                        ":one": 1
                    }
                }
            }
        ]
    };

    return await dynamo.send(new TransactWriteCommand(params));
};