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
        // PASO 1: Guardar Factura con CONDICIÓN de no existencia
        // Si el SK (hash) ya existe, cancela toda la transacción y no suma al STATS global.
        await dynamo.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: { 
                        TableName: tableName, 
                        Item: item.full_record,
                        ConditionExpression: "attribute_not_exists(SK)" // Evita duplicados
                    }
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

        // PASO 2: Asegurar nodos del mes y servicio (Solo se ejecuta si el Paso 1 fue exitoso)
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

        // PASO 3: Sumar valores anidados
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

        console.log(`✅ [SMS_PIPELINE_COMPLETE] Factura nueva procesada.`);
        return { success: true };

    } catch (error) {
        // Manejo específico para facturas duplicadas
        if (error.name === "TransactionCanceledException" || error.message.includes("ConditionalCheckFailed")) {
            console.warn(`⏭️ [SKIP]: Factura ${item.full_record.SK} ya existe. No se duplicaron estadísticas.`);
            return { success: false, reason: "ALREADY_EXISTS" };
        }

        console.error("🚨 [DYNAMO_CRITICAL_FAILURE]:", error.message);
        throw error;
    }
};