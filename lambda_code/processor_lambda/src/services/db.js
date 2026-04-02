import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

const TABLE_NAME = "sms-platform-dev-emissions";

export const persistTransaction = async (record) => {
    const { PK, SK, analytics_dimensions, climatiq_result, extracted_data, ai_analysis, metadata } = record;
    
    const year = analytics_dimensions.period_year;
    const month = analytics_dimensions.period_month.toString().padStart(2, '0');
    const service = ai_analysis.service_type || "unknown";
    const statsSK = `STATS#${year}`;

    const params = {
        TransactItems: [
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: record,
                    ConditionExpression: "attribute_not_exists(SK)" 
                }
            },
            {
                Update: {
                    TableName: TABLE_NAME,
                    Key: { PK, SK: statsSK },
                    UpdateExpression: `
                        SET by_month.#m.co2 = if_not_exists(by_month.#m.co2, :zero) + :newCo2,
                            by_month.#m.spend = if_not_exists(by_month.#m.spend, :zero) + :newSpend,
                            by_service.#s = if_not_exists(by_service.#s, :zero) + :newCo2,
                            total_co2e_kg = if_not_exists(total_co2e_kg, :zero) + :newCo2,
                            total_spend = if_not_exists(total_spend, :zero) + :newSpend,
                            invoice_count = if_not_exists(invoice_count, :zero) + :one,
                            last_updated = :now,
                            last_file_processed = :fileName
                    `,
                    ExpressionAttributeNames: { "#m": month, "#s": service },
                    ExpressionAttributeValues: {
                        ":newCo2": Number(climatiq_result.co2e),
                        ":newSpend": Number(extracted_data.total_amount),
                        ":one": 1,
                        ":zero": 0,
                        ":now": new Date().toISOString(),
                        ":fileName": metadata.filename
                    }
                }
            }
        ]
    };

    try {
        await ddb.send(new TransactWriteCommand(params));
        console.log(`✅ [DB_SUCCESS]: ${SK} y ${statsSK} actualizados.`);
        return { success: true };
    } catch (error) {
        if (error.name === "TransactionCanceledException") {
            const reasons = error.CancellationReasons;
            
            // Si falla por ruta inexistente, forzamos creación del registro STATS
            if (reasons?.[1]?.Code === "ValidationError" || error.message?.includes("document path")) {
                return await forceInitialStats(params, record);
            }

            if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
                console.warn(`⚠️ [DB_DUPLICATE]: El archivo ya fue procesado.`);
                return { skipped: true };
            }
        }
        console.error(`❌ [DB_ERROR]:`, error.message);
        throw error;
    }
};

async function forceInitialStats(originalParams, record) {
    const { PK, analytics_dimensions, climatiq_result, extracted_data, ai_analysis, metadata } = record;
    const year = analytics_dimensions.period_year;
    const month = analytics_dimensions.period_month.toString().padStart(2, '0');
    const service = ai_analysis.service_type || "unknown";
    const statsSK = `STATS#${year}`;

    const initialStats = {
        PK,
        SK: statsSK,
        by_month: {
            [month]: {
                co2: Number(climatiq_result.co2e),
                spend: Number(extracted_data.total_amount)
            }
        },
        by_service: {
            [service]: Number(climatiq_result.co2e)
        },
        total_co2e_kg: Number(climatiq_result.co2e),
        total_spend: Number(extracted_data.total_amount),
        invoice_count: 1,
        last_updated: new Date().toISOString(),
        last_file_processed: metadata.filename
    };

    try {
        await ddb.send(new TransactWriteCommand({
            TransactItems: [
                { Put: { TableName: TABLE_NAME, Item: record, ConditionExpression: "attribute_not_exists(SK)" } },
                { Put: { TableName: TABLE_NAME, Item: initialStats } }
            ]
        }));
        console.log(`✨ [DB_INIT]: Registro STATS#${year} creado satisfactoriamente.`);
        return { success: true };
    } catch (e) {
        console.error("❌ [DB_FATAL]: Fallo crítico inicializando STATS", e.message);
        throw e;
    }
}

export default { persistTransaction };