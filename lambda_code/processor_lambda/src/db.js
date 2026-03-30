const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});

/**
 * Persistencia Atómica de Factura y Actualización de Estadísticas (Multi-Ítem)
 */
exports.saveInvoiceWithStats = async (data) => {
    const { orgId, year, month, totalAmount, items } = data.internal_refs;
    const { full_record } = data;
    const tableName = process.env.DYNAMO_TABLE;

    // 1. Agregación local: Sumamos CO2 por cada tipo de servicio en la factura
    // Ej: { ELEC: 120.5, GAS: 80.2 }
    const serviceTotals = items.reduce((acc, item) => {
        acc[item.strategy] = (acc[item.strategy] || 0) + item.co2e;
        return acc;
    }, {});

    const totalCo2eFactura = Object.values(serviceTotals).reduce((a, b) => a + b, 0);

    try {
        // PASO 1: Guardar Factura e inicializar contadores mensuales/anuales
        // Transacción para asegurar que si la factura ya existe (SK), nada se guarde.
        await dynamo.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: { 
                        TableName: tableName, 
                        Item: full_record,
                        ConditionExpression: "attribute_not_exists(SK)" 
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
                                by_month.#m = if_not_exists(by_month.#m, :empty_month),
                                by_service = if_not_exists(by_service, :empty_map)
                        `,
                        ExpressionAttributeNames: { "#m": month },
                        ExpressionAttributeValues: { 
                            ":co2": totalCo2eFactura, 
                            ":money": totalAmount, 
                            ":one": 1, 
                            ":zero": 0,
                            ":empty_month": { co2: 0, spend: 0 },
                            ":empty_map": {}
                        }
                    }
                }
            ]
        }));

        // PASO 2: Iterar y actualizar cada servicio detectado en la factura
        // Esto asegura que el desglose por servicio en el Dashboard sea exacto.
        for (const [service, co2Value] of Object.entries(serviceTotals)) {
            await dynamo.send(new TransactWriteCommand({
                TransactItems: [{
                    Update: {
                        TableName: tableName,
                        Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                        UpdateExpression: `
                            SET by_service.#s = if_not_exists(by_service.#s, :zero) + :co2,
                                by_month.#m.co2 = by_month.#m.co2 + :co2,
                                by_month.#m.spend = by_month.#m.spend + :money_share
                        `,
                        ExpressionAttributeNames: { "#s": service, "#m": month },
                        ExpressionAttributeValues: { 
                            ":co2": co2Value, 
                            ":zero": 0,
                            // Asignamos el gasto total solo al primer servicio para no triplicar el gasto real
                            ":money_share": (service === Object.keys(serviceTotals)[0]) ? totalAmount : 0 
                        }
                    }
                }]
            }));
        }

        console.log(`✅ [DB_SUCCESS]: Invoice ${full_record.invoice_no} and multi-service stats updated.`);
        return { success: true };

    } catch (error) {
        if (error.name === "TransactionCanceledException" || error.message.includes("ConditionalCheckFailed")) {
            console.warn(`⏭️ [DUPLICATE_SKIP]: SK ${full_record.SK} already exists.`);
            return { success: false, reason: "ALREADY_EXISTS" };
        }

        console.error("🚨 [DYNAMO_ERROR]:", error.message);
        throw error;
    }
};