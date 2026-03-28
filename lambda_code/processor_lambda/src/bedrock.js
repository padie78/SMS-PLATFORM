const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });

/**
 * Strict Data Normalization
 * No default values here; only type parsing to ensure contract integrity.
 */
function validarYLimpiarResultado(resultado) {
    const parseNumeric = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const clean = val.replace(/[^\d,.-]/g, '').replace(',', '.');
            const parsed = parseFloat(clean);
            return isNaN(parsed) ? null : parsed;
        }
        return null;
    };

    if (resultado.extracted_data) {
        resultado.extracted_data.total_amount = parseNumeric(resultado.extracted_data.total_amount);
    }

    if (resultado.ai_analysis) {
        resultado.ai_analysis.value = parseNumeric(resultado.ai_analysis.value);
        resultado.ai_analysis.year = parseInt(resultado.ai_analysis.year) || null;
    }

    // Critical: If any root section is missing, we fail to force prompt debugging
    if (!resultado.extracted_data || !resultado.ai_analysis || !resultado.climatiq_ready_payload) {
        throw new Error("Missing mandatory root JSON sections from Bedrock response.");
    }

    return resultado;
}

/**
 * AI Normalization Pipeline (Sustainability Management System)
 */
exports.entenderConIA = async (summary, queryHints) => {
    const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

    const systemPrompt = `You are a Senior Sustainability Data Engineer. 
      Mission: Act as a deterministic middleware between raw OCR data and the Climatiq API.

      ### CORE OPERATIONAL RULES:
      1. MANDATORY FIELDS: Every field in the JSON schema is REQUIRED. Do not omit any keys.
      2. NO PROSE: Your output must be ONLY a valid JSON object. No explanations or extra text.
      3. DATA MERGING: Prioritize QUERY_HINTS for header info (vendor, currency). Search SUMMARY/LINE_ITEMS for consumption values (kWh, m3, Liters).
      4. REGION NORMALIZATION: Identify the country and return ONLY the ISO 3166-1 alpha-2 code (e.g., 'ES' for Spain, 'IL' for Israel).
      5. PARAMETER MAPPING: 
         - For 'elec' or 'gas' -> parameter_type MUST be 'energy'.
         - For 'water' or 'fuel' -> parameter_type MUST be 'volume'.
         - For money-based -> parameter_type MUST be 'money'.

      ### CLIMATIQ MAPPING REFERENCE:
      - ELECTRICITY: 'electricity-supply_grid-source_production_mix'
      - WATER: 'water-type_tap_water'
      - NATURAL GAS: 'natural_gas-fuel_type_natural_gas'
      - DIESEL: 'fuel-type_diesel_fuel-source_generic'

      ### REQUIRED OUTPUT SCHEMA:
      {
        "extracted_data": {
          "vendor": "string",
          "invoice_number": "string",
          "invoice_date": "YYYY-MM-DD",
          "billing_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
          "total_amount": float,
          "currency": "ISO_4217"
        },
        "ai_analysis": {
          "service_type": "elec|gas|water|fuel",
          "year": int,
          "calculation_method": "consumption_based|spend_based",
          "activity_id": "string",
          "parameter_type": "energy|volume|money",
          "value": float,
          "unit": "string",
          "region": "ISO_CODE",
          "confidence_score": float,
          "insight_text": "string"
        },
        "climatiq_ready_payload": {
          "activity_id": "string",
          "region": "ISO_CODE",
          "parameters": {
            "[parameter_type]": float,
            "[parameter_type]_unit": "string"
          }
        }
      }`;

    const userPrompt = `Analyze this document for carbon accounting:
    QUERY_HINTS: ${JSON.stringify(queryHints)}
    FULL_SUMMARY: ${summary}`;

    const bodyPayload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0
    };

    try {
        const command = new InvokeModelCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(bodyPayload)
        });

        const startTime = Date.now();
        const response = await client.send(command);
        const duration = Date.now() - startTime;

        const rawRes = new TextDecoder().decode(response.body);
        const parsedRes = JSON.parse(rawRes);
        const contentText = parsedRes.content?.[0]?.text || "";

        console.log("=== [BEDROCK_DEBUG] ===");
        console.log(`Latency: ${duration}ms`);

        const firstBracket = contentText.indexOf('{');
        const lastBracket = contentText.lastIndexOf('}');
        
        if (firstBracket === -1 || lastBracket === -1) {
            throw new Error("Bedrock did not return a valid JSON block.");
        }

        const jsonString = contentText.substring(firstBracket, lastBracket + 1);
        let finalResult = JSON.parse(jsonString);

        // Final clean-up and contract validation
        finalResult = validarYLimpiarResultado(finalResult);

        console.log("--- [BEDROCK_NORMALIZED_RESULT] ---");
        console.log(JSON.stringify(finalResult, null, 2));
        console.log("✅ AI Normalization successful for:", finalResult.extracted_data.vendor);
        console.log("-----------------------------------");
        return finalResult;

    } catch (error) {
        console.error("🚨 [BEDROCK_PIPELINE_ERROR]:", error.message);
        throw new Error(`AI Normalization Failed: ${error.message}`);
    }
};