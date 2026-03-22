const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.entenderConIA = async (texto) => {
    const prompt = `Analiza este texto de una factura de servicios: "${texto}". 
    Extrae: tipo de servicio (luz, gas, agua), cantidad de consumo y unidad.
    Responde ÚNICAMENTE con el objeto JSON, sin texto adicional: 
    {"tipo": "string", "cantidad": number, "unidad": "string"}`;

    const input = {
        modelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 500,
            messages: [{ role: "user", content: prompt }]
        })
    };

    try {
        const response = await client.send(new InvokeModelCommand(input));
        const rawRes = new TextDecoder().decode(response.body);
        const parsedRes = JSON.parse(rawRes);
        const contentText = parsedRes.content[0].text;

        // Limpieza de seguridad para extraer solo el JSON entre { }
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Bedrock no devolvió un JSON válido.");

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Error en Bedrock:", error);
        throw new Error("La IA no pudo procesar los datos de la factura.");
    }
};