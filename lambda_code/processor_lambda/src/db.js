const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
});

exports.saveInvoiceWithStats = async (item) => {
    const { orgId, year, month, serviceType, co2e, totalAmount } = item.internal_refs;
    const tableName = process.env.DYNAMO_TABLE;

    const params = {
        TransactItems: [
            {
                Put: {
                    TableName: tableName,
                    Item: item.full_record
                }
            },
            {
                Update: {
                    TableName: tableName,
                    Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                    // Eliminamos el SET de los mapas para evitar el solapamiento de rutas.
                    // Usamos SET solo para los contadores base y ADD para lo anidado.
                    UpdateExpression: `
                        SET total_co2e_kg = if_not_exists(total_co2e_kg, :zero) + :co2,
                            total_spend = if_not_exists(total_spend, :zero) + :money,
                            invoice_count = if_not_exists(invoice_count, :zero) + :one
                        ADD by_month.#m.co2 :co2, 
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
                        ":one": 1,
                        ":zero": 0
                    }
                }
            }
        ]
    };

    try {
        console.log(`--- [DYNAMO_TX_FINAL_ATTEMPT] ORG#${orgId} | STATS#${year} ---`);
        return await dynamo.send(new TransactWriteCommand(params));
    } catch (error) {
        // Si el error es "The document path provided in the mapping for item does not exist"
        // significa que el registro STATS#YEAR es totalmente nuevo y no tiene los mapas vacíos.
        if (error.name === "TransactionCanceledException") {
            console.warn("⚠️ [STATS_NOT_INITIALIZED]: Intentando inicializar registro anual...");
            return await handleStatsInitialization(orgId, year, params);
        }
        throw error;
    }
};

/**
 * Función de respaldo: Si el registro STATS no existe, lo crea con los mapas base.
 */
async function handleStatsInitialization(orgId, year, originalParams) {
    const tableName = process.env.DYNAMO_TABLE;
    
    // Paso 1: Inicializar el registro de estadísticas vacío con los mapas necesarios
    await dynamo.send(new TransactWriteCommand({
        TransactItems: [{
            Update: {
                TableName: tableName,
                Key: { PK: `ORG#${orgId}`, SK: `STATS#${year}` },
                UpdateExpression: "SET by_month = if_not_exists(by_month, :m), by_service = if_not_exists(by_service, :m)",
                ExpressionAttributeValues: { ":m": {} }
            }
        }]
    }));

    // Paso 2: Reintentar la transacción original
    return await dynamo.send(new TransactWriteCommand(originalParams));
}