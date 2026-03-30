const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { STRATEGIES } = require("./constants/climatiq_catalog");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });
const MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

exports.entenderFacturaParaClimatiq = async (summary, queryHints = {}) => {
    const systemPrompt = `
You are a Senior Sustainability Data Engineer & ESG Auditor.
Mission: Extract both accounting and emission data from invoice OCR summaries.

### CORE OPERATIONAL RULES:
1. MULTI-ITEM EXTRACTION: Identify ALL separate emission sources (e.g., Gas and Electricity in the same bill). Separate them into the "emission_lines" array.
2. CLASSIFICATION: Map each item to exactly ONE of these strategies: ${Object.keys(STRATEGIES).join(', ')}.
3. IDENTITY: Extract full vendor details (Name and Tax ID if visible).
4. TEMPORAL PRECISION: Differentiate between 'invoice_date' and 'billing_period'. Emission factors depend on the year of consumption.
5. NO PROSE: Output ONLY valid JSON. No conversational text or markdown blocks.
6. DATA TYPES: All "value", "weight", "distance" fields MUST be float/numbers, never strings.
7. EMPTY STATE: If no items are found, return "emission_lines": [].

### REQUIRED OUTPUT SCHEMA:
{
  "extracted_data": {
    "vendor": { "name": "string", "tax_id": "string", "address": "string" },
    "invoice_number": "string",
    "invoice_date": "YYYY-MM-DD",
    "billing_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "currency": "ISO_4217",
    "total_amount_with_tax": float,
    "total_amount_net": float
  },
  "emission_lines": [
    {
      "strategy": "ELEC|GAS|LOGISTICS|FLEET|WASTE_PAPER",
      "description": "Short description of the line item",
      "confidence_score": float,
      "reasoning": "string",
      "year": int,
      "region": "ISO_CODE",
      "value": float,
      "unit": "string",
      "logistics_meta": {
         "weight": float,
         "distance": float
      }
    }
  ]
}`;

    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000, // Incrementado para soportar múltiples líneas con seguridad
        system: systemPrompt,
        messages: [{ 
            role: "user", 
            content: `Analyze this invoice: ${summary}. Hints: ${JSON.stringify(queryHints)}` 
        }],
        temperature: 0
    };

    try {
        const command = new InvokeModelCommand({
            modelId: MODEL_ID,
            contentType: "application/json",
            body: JSON.stringify(payload)
        });

        const response = await client.send(command);
        const rawRes = JSON.parse(new TextDecoder().decode(response.body));
        
        let contentText = rawRes.content[0].text.trim();

        // LIMPIEZA CRUCIAL: Regex para extraer solo el objeto JSON
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            contentText = jsonMatch[0];
        }

        const finalJson = JSON.parse(contentText);

        // NORMALIZACIÓN DE EMERGENCIA: 
        // Si por algún motivo la IA devolvió "ai_analysis" (formato viejo), lo envolvemos en un array.
        if (finalJson.ai_analysis && !finalJson.emission_lines) {
            finalJson.emission_lines = [finalJson.ai_analysis];
            delete finalJson.ai_analysis;
        }

        return finalJson;

    } catch (error) {
        console.error("🚨 [BEDROCK_PROCESSOR_ERROR]:", error.message);
        throw error;
    }
};