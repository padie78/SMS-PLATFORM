const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });

exports.entenderConIA = async (summary, items) => {
    // 1. ID de Perfil de Inferencia (Obligatorio para evitar el error de On-Demand)
    const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

    const systemPrompt = `You are a specialized Sustainability Data Engineer. 
    Your role is to parse structured OCR data from utility invoices and map them to GHG Protocol and Climatiq API standards.
    
    OUTPUT STRUCTURE (Strict JSON):
    {
      "extracted_data": {
        "vendor": "String",
        "invoice_date": "YYYY-MM-DD",
        "total_amount": Number,
        "currency": "ISO Code",
        "city": "String"
      },
      "ai_analysis": {
        "service_type": "electricity|natural_gas|water|fuel|waste",
        "scope": 1|2|3,
        "suggested_query": "Climatiq-optimized search string",
        "consumption_value": Number,
        "consumption_unit": "kWh|L|m3|kg",
        "confidence_score": Number,
        "insight_text": "Short sustainability insight"
      }
    }

    CONSTRAINTS:
    - Respond ONLY with valid JSON.
    - Translation: semantic terms to English.
    - Use null if not found.`;

    const userPrompt = `Parse the following OCR results:
    SUMMARY FIELDS: ${JSON.stringify(summary)}
    LINE ITEMS: ${JSON.stringify(items)}`;

    // 2. Ajuste del Payload: La estructura debe ser exacta para Bedrock Runtime
    const bodyPayload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        system: systemPrompt, // El system prompt va aquí afuera de 'messages'
        messages: [
            { 
                role: "user", 
                content: [{ type: "text", text: userPrompt }] // Estructura de contenido explícita
            }
        ],
        temperature: 0
    };

    const params = {
        modelId: modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(bodyPayload)
    };

    try {
        console.log(`[STEP 2] Invocando Bedrock con el perfil: ${modelId}`);
        const command = new InvokeModelCommand(params);
        const response = await client.send(command);
        
        const rawRes = new TextDecoder().decode(response.body);
        const parsedRes = JSON.parse(rawRes);
        
        // 3. Extracción robusta del contenido
        const contentText = parsedRes.content[0].text;

        // Limpieza por si la IA añade texto extra
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in AI response");

        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("Architect Error - Bedrock Pipeline:", error);
        // Si el error es ValidationException aquí, es 100% por el ID del modelo
        throw new Error(`AI failed to normalize invoice data: ${error.message}`);
    }
};