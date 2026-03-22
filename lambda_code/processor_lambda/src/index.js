const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { extraerTexto } = require("./textract");
const { entenderConIA } = require("./bedrock");
const { calcularEnApiExterna } = require("./external-api");

// Inicialización fuera del handler (Warm Start)
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const dynamo = DynamoDBDocumentClient.from(ddbClient);

exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        // Estructura: uploads/{clientId}/{filename}
        const parts = key.split('/');
        const clientId = parts[1] || 'unknown'; 

        console.log(`[START] Procesando: ${key} | Cliente: ${clientId}`);

        try {
            // 1. OCR con Textract
            const texto = await extraerTexto(bucket, key);
            
            // 2. Clasificación con Bedrock (Claude 3 Haiku)
            const datosFactura = await entenderConIA(texto);
            
            // 3. Cálculo de CO2e (API Externa)
            const resultadoCO2 = await calcularEnApiExterna(datosFactura);

            const processedAt = new Date().toISOString();
            
            // 4. Persistencia Dual (Histórico + Latest)
            const commonItem = {
                PK: `CLIENT#${clientId}`,
                data: datosFactura,
                co2e: resultadoCO2,
                fileRef: key,
                processedAt: processedAt
            };

            // Guardar Histórico
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: { ...commonItem, SK: `EMISSION#${Date.now()}`, status: "VERIFIED" }
            }));

            // Actualizar Latest para el Dashboard
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: { ...commonItem, SK: `LATEST_EMISSION` }
            }));

            console.log(`[SUCCESS] Cliente ${clientId}: ${resultadoCO2} kg CO2e`);
            results.push({ key, status: 'success' });

        } catch (err) {
            console.error(`[ERROR] Falló procesamiento de ${key}:`, err.message);
            results.push({ key, status: 'error', message: err.message });
        }
    }
    return results;
};