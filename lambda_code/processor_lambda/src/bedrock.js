const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });

exports.entenderConIA = async (summary, items) => {
    // ID del Perfil de Inferencia verificado
    const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

    const systemPrompt = `You are a specialized Sustainability Data Engineer. 
    Your role is to parse structured OCR data and map them EXACTLY to Climatiq API standards.
    
    OUTPUT STRUCTURE (Strict JSON):
    {
      "extracted_data": {
        "vendor": "String",
        "invoice_date": "YYYY-MM-DD",
        "total_amount": Number,
        "currency": "ISO Code"
      },
      "ai_analysis": {
        "activity_id": "String (Use 'electricity-supply_grid-source_mainland_uk_grid' for electricity, 'fuel-combustion_type_natural_gas' for gas, or 'fuel-combustion_type_diesel' for fuel)",
        "parameter_type": "energy|volume|weight|money",
        "value": Number,
        "unit": "kWh|m3|kg|l",
        "confidence_score": Number
      }
    }

    CRITICAL CONSTRAINTS:
    - parameter_type MUST be one of: 'energy', 'volume', 'weight', 'money'.
    - If you find electricity, set parameter_type to 'energy' and unit to 'kWh'.
    - If you find gas, set parameter_type to 'volume' and unit to 'm3'.
    - Respond ONLY with valid JSON. Do not include conversational text.`;

    const userPrompt = `Parse the following OCR results:
    SUMMARY FIELDS: ${JSON.stringify(summary)}
    LINE ITEMS: ${JSON.stringify(items)}`;

    const bodyPayload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
            { 
                role: "user", 
                content: [{ type: "text", text: userPrompt }]
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
        
        // Extracción robusta del contenido de la respuesta de Claude
        const contentText = parsedRes.content[0].text;

        // Limpieza de posibles etiquetas Markdown que a veces añade la IA
        const cleanJson = contentText.replace(/```json|```/g, "").trim();
        
        const finalResult = JSON.parse(cleanJson);

        // VALIDACIÓN PREVIA: Si faltan campos críticos, lanzamos error aquí antes de ir a Climatiq
        if (!finalResult.ai_analysis || !finalResult.ai_analysis.activity_id) {
            console.error("[BEDROCK_ERROR] La IA devolvió un JSON incompleto:", finalResult);
            throw new Error("Incomplete AI Analysis: Missing activity_id");
        }

        return finalResult;

    } catch (error) {
        console.error("Architect Error - Bedrock Pipeline:", error);
        throw new Error(`AI failed to normalize invoice data: ${error.message}`);
    }
};