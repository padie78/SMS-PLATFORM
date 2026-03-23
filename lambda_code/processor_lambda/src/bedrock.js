const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "eu-central-1" });

/**
 * Procesa datos de Textract usando Claude 3.5 Haiku para normalización de datos de sostenibilidad.
 * @param {Object} summary - Campos de resumen de Textract
 * @param {Array} items - Líneas de detalle de Textract
 */
exports.entenderConIA = async (summary, items) => {
    // 1. IMPORTANTE: Usamos la versión 3.5 para evitar el error de "Legacy Model"
    const modelId = "eu.anthropic.claude-4-5-haiku-20251030-v1:0";
    

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
        "confidence_score": Number (0-1),
        "insight_text": "Short sustainability insight"
      }
    }

    CONSTRAINTS:
    - Respond ONLY with valid JSON.
    - If data is in Spanish/Hebrew, translate semantic terms for 'suggested_query' to English.
    - Use null if a value is not found.`;

    // Enviamos los datos estructurados para que la IA no tenga que "adivinar" el texto
    const userPrompt = `Parse the following OCR results:
    SUMMARY FIELDS: ${JSON.stringify(summary)}
    LINE ITEMS: ${JSON.stringify(items)}`;

    const params = {
        modelId: modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            temperature: 0 // Mantenerlo en 0 para máxima consistencia en extracción de datos
        })
    };

    try {
        const command = new InvokeModelCommand(params);
        const response = await client.send(command);
        
        const rawRes = new TextDecoder().decode(response.body);
        const parsedRes = JSON.parse(rawRes);
        
        // Claude en Bedrock devuelve el texto dentro de content[0].text
        const contentText = parsedRes.content[0].text;

        // Limpieza de posibles explicaciones fuera del JSON
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in AI response");

        const finalData = JSON.parse(jsonMatch[0]);

        return {
            extracted_data: finalData.extracted_data,
            ai_analysis: finalData.ai_analysis
        };

    } catch (error) {
        console.error("Architect Error - Bedrock Pipeline:", error);
        throw new Error(`AI failed to normalize invoice data: ${error.message}`);
    }
};