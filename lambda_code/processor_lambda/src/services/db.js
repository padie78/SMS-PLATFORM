import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const ddb = DynamoDBDocumentClient.from(client, { 
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true } 
});

const TABLE_NAME = "sms-platform-dev-emissions";

export const persistTransaction = async (record) => {
    const { PK, SK, analytics_dimensions, climatiq_result, extracted_data, ai_analysis, metadata } = record;
    
    const year = analytics_dimensions.period_year;
    const month = analytics_dimensions.period_month.toString().padStart(2, '0');
    const service = (ai_analysis.service_type || "unknown").toUpperCase();
    const statsSK = `STATS#${year}`;

    // Valores numéricos seguros
    const newCo2 = Number(climatiq_result.co2e || 0);
    const newSpend = Number(extracted_data.total_amount || 0);

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
                    // Usamos list_append o encadenamos inicializaciones si fuera necesario, 
                    // pero para mapas anidados lo mejor es asegurar que el nivel superior exista.
                    UpdateExpression: `
                        SET by_month = if_not_exists(by_month, :emptyMap),
                            by_service = if_not_exists(by_service, :emptyMap),
                            total_co2e_kg = if_not_exists(total_co2e_kg, :zero) + :newCo2,
                            total_spend = if_not_exists(total_spend, :zero) + :newSpend,
                            invoice_count = if_not_exists(invoice_count, :zero) + :one,
                            last_updated = :now,
                            last_file_processed = :fileName
                    `,
                    ExpressionAttributeValues: {
                        ":newCo2": newCo2,
                        ":newSpend": newSpend,
                        ":one": 1,
                        ":zero": 0,
                        ":emptyMap": {},
                        ":now": new Date().toISOString(),
                        ":fileName": metadata.filename
                    }
                }
            }
        ]
    };

    try {
        await ddb.send(new TransactWriteCommand(params));
        
        // SEGUNDO PASO: Actualizar los valores específicos dentro de los mapas
        // DynamoDB no permite inicializar un mapa y sumar a un hijo en la misma Transact Item de forma sencilla
        // Así que lo ideal es esta estructura de "Update" que ya tienes, pero con un fallback.
        
        await updateDetailedStats(PK, statsSK, month, service, newCo2, newSpend);
        
        console.log(`✅ [DB_SUCCESS]: ${SK} y ${statsSK} actualizados.`);
        return { success: true };
    } catch (error) {
        if (error.name === "TransactionCanceledException") {
            const reasons = error.CancellationReasons;
            
            // Si el error es en el ítem 1 (el Update de Stats)
            if (reasons?.[1]?.Code === "ValidationError" || error.message?.includes("document path")) {
                return await forceInitialStats(record);
            }

            if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
                console.warn(`⚠️ [DB_DUPLICATE]: Factura ya procesada anteriormente.`);
                return { skipped: true };
            }
        }
        throw error;
    }
};

// Función para actualizar los niveles profundos (mes y servicio)
async function updateDetailedStats(PK, SK, month, service, co2, spend) {
    const updateParams = {
        TableName: TABLE_NAME,
        Key: { PK, SK },
        UpdateExpression: `
            SET by_month.#m = if_not_exists(by_month.#m, :emptyData),
                by_service.#s = if_not_exists(by_service.#s, :zero) + :co2
        `,
        ExpressionAttributeNames: { "#m": month, "#s": service },
        ExpressionAttributeValues: {
            ":co2": co2,
            ":zero": 0,
            ":emptyData": { co2: 0, spend: 0 }
        }
    };

    // Aplicamos el incremento final al mes
    const finalUpdate = {
        TableName: TABLE_NAME,
        Key: { PK, SK },
        UpdateExpression: `
            SET by_month.#m.co2 = by_month.#m.co2 + :co2,
                by_month.#m.spend = by_month.#m.spend + :spend
        `,
        ExpressionAttributeNames: { "#m": month },
        ExpressionAttributeValues: { ":co2": co2, ":spend": spend }
    };

    // Ejecutar secuencialmente para asegurar estructura
    try {
        // Primero aseguramos que existan las llaves del mes y el servicio
        await ddb.send(new UpdateCommand(updateParams));
        // Luego sumamos los valores
        await ddb.send(new UpdateCommand(finalUpdate));
    } catch (e) {
        console.error("Error actualizando detalle de stats", e);
    }
}

export default { persistTransaction };