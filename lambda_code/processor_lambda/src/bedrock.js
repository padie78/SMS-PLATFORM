const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "eu-central-1" });

exports.entenderConIA = async (texto) => {
    // Definimos las reglas de negocio en inglés para máxima precisión del modelo
    const systemPrompt = `You are a specialized Sustainability Data Engineer. Your role is to parse raw text from utility invoices and map them to GHG Protocol and Climatiq API standards.
    
    CORE OBJECTIVES:
    1. Identify the 'service_type' (electricity, natural_gas, water, fuel, etc.).
    2. Extract 'quantity' (numeric only) and 'unit' (standardized: kWh, L, m3, km).
    3. Determine the 'scope' (1, 2, or 3) based on GHG Protocol.
    4. Provide a 'suggested_query' optimized for Climatiq's /search endpoint.
    
    CONSTRAINTS:
    - Respond ONLY with a valid JSON object.
    - No conversational text or explanations.
    - Use null if a value is not found.
    - If the input is in Spanish or Hebrew, translate semantic terms to English for the 'suggested_query'.`;

    const userPrompt = `Parse the following invoice text: "${texto}"`;

    const input = {
        modelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            system: systemPrompt, // Aquí inyectamos las reglas
            messages: [{ role: "user", content: userPrompt }]
        })
    };

    try {
        const response = await client.send(new InvokeModelCommand(input));
        const rawRes = new TextDecoder().decode(response.body);
        const parsedRes = JSON.parse(rawRes);
        const contentText = parsedRes.content[0].text;

        // Extraemos solo el bloque JSON por seguridad
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid JSON structure in AI response.");

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Architect Error - Bedrock Pipeline:", error);
        throw new Error("AI failed to normalize invoice data.");
    }
};