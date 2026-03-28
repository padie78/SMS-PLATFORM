const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});

exports.saveInvoiceWithStats = async (item) => {
    const { orgId, year, month, serviceType, co2e, totalAmount } = item.internal_refs;
    const tableName = process.env.DYNAMO_TABLE;

    try {
        // PASO 1: Guardar Factura e inicializar totales anuales (Esto ya funciona)
        await dynamo.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: { TableName: tableName, Item: item.full_record }
                },
                {
                    Update: {
                        TableName: tableName,
                        Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                        UpdateExpression: `
                            SET total_co2e_kg = if_not_exists(total_co2e_kg, :zero) + :co2,
                                total_spend = if_not_exists(total_spend, :zero) + :money,
                                invoice_count = if_not_exists(invoice_count, :zero) + :one,
                                by_month = if_not_exists(by_month, :empty_map),
                                by_service = if_not_exists(by_service, :empty_map)
                        `,
                        ExpressionAttributeValues: { 
                            ":co2": co2e, ":money": totalAmount, ":one": 1, ":zero": 0, ":empty_map": {} 
                        }
                    }
                }
            ]
        }));

        // PASO 2: Actualizar el detalle mensual y por servicio (Sin overlap)
        // Usamos una lógica de SET incremental para evitar el conflicto de ADD/SET
        await dynamo.send(new TransactWriteCommand({
            TransactItems: [{
                Update: {
                    TableName: tableName,
                    Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                    UpdateExpression: `
                        SET by_month.#m = if_not_exists(by_month.#m, :empty_month),
                            by_service.#s = if_not_exists(by_service.#s, :zero)
                    `,
                    ExpressionAttributeNames: { "#m": month, "#s": serviceType },
                    ExpressionAttributeValues: { 
                        ":zero": 0, 
                        ":empty_month": { co2: 0, spend: 0 } 
                    }
                }
            }]
        }));

        // PASO 3: Ahora sí, sumamos los valores a los nodos garantizados
        await dynamo.send(new TransactWriteCommand({
            TransactItems: [{
                Update: {
                    TableName: tableName,
                    Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                    UpdateExpression: `
                        ADD by_month.#m.co2 :co2, 
                            by_month.#m.spend :money,
                            by_service.#s :co2
                    `,
                    ExpressionAttributeNames: { "#m": month, "#s": serviceType },
                    ExpressionAttributeValues: { ":co2": co2e, ":money": totalAmount }
                }
            }]
        }));

        console.log(`✅ [SMS_PIPELINE_COMPLETE] Factura procesada y estadísticas actualizadas.`);
        return { success: true };

    } catch (error) {
        console.error("🚨 [DYNAMO_CRITICAL_FAILURE]:", error.message);
        throw error;
    }
};