const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });

exports.entenderConIA = async (summary, items) => {
    // ID del Perfil de Inferencia verificado
    const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

    const systemPrompt = `You are a Senior Sustainability Data Engineer specialized in GHG Protocol (Scope 1, 2, and 3). 
    Your mission is to act as a deterministic middleware between raw OCR text and the Climatiq API.

    ### OBJECTIVE:
    Normalize inconsistent OCR data into a strict, validated JSON schema for carbon footprint calculation.

    ### STRICT ENUM DEFINITIONS (MANDATORY):
    - ai_analysis.service_type: ["Electricity", "Gas", "Water", "Fuel", "Waste", "Unknown"]
    - ai_analysis.scope: [1, 2, 3]
    - ai_analysis.calculation_method: ["consumption_based", "spend_based"]
    - ai_analysis.parameter_type: ["energy", "volume", "weight", "money"]

    ### LOGIC RULES FOR ENUMS:
    1. calculation_method:
      - Use 'consumption_based' ONLY if physical units (kWh, m3, L) are found in the OCR.
      - Use 'spend_based' ONLY if physical units are missing and you must use 'total_amount'.
    2. scope:
      - 2: For Electricity (Purchased energy).
      - 1: For Natural Gas, Diesel, or Fuel (Direct combustion).
      - 3: For Water, Waste, or external services.
    3. parameter_type & unit:
      - If Electricity -> parameter_type: 'energy', unit: 'kWh'.
      - If Gas/Water/Fuel -> parameter_type: 'volume', unit: 'm3' or 'l'.
      - If calculation_method is 'spend_based' -> parameter_type: 'money', unit: MUST be the Currency ISO Code (e.g., 'ARS', 'USD').

    ### CLIMATIQ MAPPING:
    - ELECTRICITY -> activity_id: 'electricity-supply_grid-source_residual_mix'
    - NATURAL GAS -> activity_id: 'fuel-combustion_type_natural_gas'
    - DIESEL/FUEL -> activity_id: 'fuel-combustion_type_diesel'
    - WATER -> activity_id: 'water-supply_type_tap_water'

    ### OUTPUT JSON SCHEMA (STRICT):
    {
      "extracted_data": {
        "vendor": "String (Upper Case)",
        "invoice_number": "String or null",
        "invoice_date": "YYYY-MM-DD",
        "period_start": "YYYY-MM-DD or null",
        "period_end": "YYYY-MM-DD or null",
        "total_amount": Number (Float),
        "currency": "ISO 4217 Code",
        "raw_consumption": Number (Float) or null,
        "raw_unit": "String or null"
      },
      "ai_analysis": {
        "service_type": "String (Enum)",
        "scope": Number (Integer),
        "calculation_method": "String (Enum)",
        "activity_id": "String (Climatiq ID)",
        "parameter_type": "String (Enum)",
        "value": Number (Float),
        "unit": "String",
        "confidence_score": Number (Float 0.0-1.0),
        "requires_review": Boolean,
        "is_estimated_reading": Boolean,
        "insight_text": "String (Short analysis of trends or anomalies)"
      }
    }

    ### CRITICAL CONSTRAINTS:
    - DO NOT include conversational text or markdown code blocks (``json). Return ONLY the raw JSON string.
    - NUMERICAL VALUES: No thousands separators. Use dot (.) for decimals (e.g., 1500.75).
    - DATES: Format MUST be ISO 8601 (YYYY-MM-DD).
    - FALLBACK: If data is ambiguous or confidence < 0.85, set "requires_review": true.
    - AGGREGATION: If multiple line items exist for the same service, sum the 'value' into a single entry.`;

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