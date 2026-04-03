import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const ddb = DynamoDBDocumentClient.from(client, { 
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true } 
});

const TABLE_NAME = "sms-platform-dev-emissions";

export const persistTransaction = async (record) => {
    const { PK, analytics_dimensions, climatiq_result, extracted_data, ai_analysis, metadata } = record;
    
    const year = analytics_dimensions.period_year;
    const month = analytics_dimensions.period_month.toString().padStart(2, '0');
    const service = (ai_analysis.service_type || "UNKNOWN").toUpperCase();
    const statsSK = `STATS#${year}`;

    // 1. Extraemos todos los valores de gases del registro (vienen del nuevo Mapper)
    const nCo2e = Number(climatiq_result.co2e || 0);
    const nCo2  = Number(climatiq_result.co2 || 0);
    const nCh4  = Number(climatiq_result.ch4 || 0);
    const nN2o  = Number(climatiq_result.n2o || 0);
    const nSpend = Number(extracted_data.total_amount || 0);

    const params = {
        TransactItems: [
            {
                // INSERTAR TRANSACCIÓN (Idempotencia basada en SK Natural)
                Put: {
                    TableName: TABLE_NAME,
                    Item: record,
                    ConditionExpression: "attribute_not_exists(SK)" 
                }
            },
            {
                // ACTUALIZAR ESTADÍSTICAS ANUALES (Estructura Plana)
                Update: {
                    TableName: TABLE_NAME,
                    Key: { PK, SK: statsSK },
                    UpdateExpression: `
                        SET #mCo2e = if_not_exists(#mCo2e, :zero) + :nCo2e,
                            #mCo2  = if_not_exists(#mCo2, :zero) + :nCo2,
                            #mCh4  = if_not_exists(#mCh4, :zero) + :nCh4,
                            #mN2o  = if_not_exists(#mN2o, :zero) + :nN2o,
                            #mSpend = if_not_exists(#mSpend, :zero) + :nSpend,
                            #sCo2e = if_not_exists(#sCo2e, :zero) + :nCo2e,
                            total_co2e_kg = if_not_exists(total_co2e_kg, :zero) + :nCo2e,
                            total_spend = if_not_exists(total_spend, :zero) + :nSpend,
                            invoice_count = if_not_exists(invoice_count, :zero) + :one,
                            last_updated = :now,
                            last_file_processed = :fileName
                    `,
                    ExpressionAttributeNames: { 
                        "#mCo2e": `month_${month}_co2e`,
                        "#mCo2":  `month_${month}_co2`,
                        "#mCh4":  `month_${month}_ch4`,
                        "#mN2o":  `month_${month}_n2o`,
                        "#mSpend": `month_${month}_spend`,
                        "#sCo2e": `service_${service}_co2e`
                    },
                    ExpressionAttributeValues: {
                        ":nCo2e": nCo2e,
                        ":nCo2":  nCo2,
                        ":nCh4":  nCh4,
                        ":nN2o":  nN2o,
                        ":nSpend": nSpend,
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
        console.log(`✅ [DB_SUCCESS]: Transacción guardada y Stats de gases actualizados.`);
        return { success: true };
    } catch (error) {
        if (error.name === "TransactionCanceledException") {
            const reasons = error.CancellationReasons;
            if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
                console.warn(`⚠️ [DB_DUPLICATE]: Factura ${record.SK} ya existe. Abortando para evitar duplicidad de gases.`);
                return { skipped: true };
            }
        }
        console.error("❌ [DB_ERROR]:", error.message);
        throw error;
    }
};

export default { persistTransaction };