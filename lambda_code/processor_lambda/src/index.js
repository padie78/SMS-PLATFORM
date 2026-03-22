exports.handler = async (event) => {
    const results = [];

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        // CORRECCIÓN: Si el path es "uploads/ID_CLIENTE/archivo.pdf"
        // parts[0] = uploads, parts[1] = ID_CLIENTE
        const parts = key.split('/');
        const clientId = parts[1] || 'unknown'; 

        console.log(`Iniciando procesamiento: ${key} para Cliente: ${clientId}`);

        try {
            const texto = await extraerTexto(bucket, key);
            const datosFactura = await entenderConIA(texto);
            const resultadoCO2 = await calcularEnApiExterna(datosFactura);

            // ESTRATEGIA DE PERSISTENCIA:
            // Usamos una SK fija para el "LATEST" y una con timestamp para el historial
            const processedAt = new Date().toISOString();
            
            // 1. Guardar el registro histórico
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: {
                    PK: `CLIENT#${clientId}`,
                    SK: `EMISSION#${Date.now()}`,
                    data: datosFactura,
                    co2e: resultadoCO2,
                    fileRef: key,
                    status: "VERIFIED",
                    processedAt: processedAt
                }
            }));

            // 2. ACTUALIZACIÓN "LATEST": Esto permite que el dashboard 
            // siempre muestre el último proceso sin buscar en todo el historial.
            await dynamo.send(new PutCommand({
                TableName: process.env.DYNAMO_TABLE,
                Item: {
                    PK: `CLIENT#${clientId}`,
                    SK: `LATEST_EMISSION`, 
                    co2e: resultadoCO2,
                    processedAt: processedAt,
                    fileRef: key
                }
            }));

            results.push({ key, status: 'success' });

        } catch (err) {
            // ... tu lógica de error actual está bien ...
        }
    }
    return results;
};