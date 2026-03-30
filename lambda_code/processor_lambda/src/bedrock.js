const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { STRATEGIES } = require("./constants/climatiq_catalog");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });
const MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

exports.entenderFacturaParaClimatiq = async (summary, queryHints = {}) => {
    const systemPrompt = `
You are a Senior Sustainability Data Engineer & ESG Auditor.
Mission: Extract both accounting and emission data from invoice OCR summaries.

### CORE OPERATIONAL RULES:
1. CLASSIFICATION: Map the invoice to exactly ONE of these strategies: ${Object.keys(STRATEGIES).join(', ')}.
2. IDENTITY: Extract full vendor details (Name and Tax ID if visible).
3. TEMPORAL PRECISION: Differentiate between 'invoice_date' and 'billing_period'. Emission factors depend on the year of consumption.
4. NO PROSE: Output ONLY valid JSON.

### REQUIRED OUTPUT SCHEMA:
{
  "extracted_data": {
    "vendor": {
        "name": "string",
        "tax_id": "string",
        "address": "string"
    },
    "invoice_number": "string",
    "invoice_date": "YYYY-MM-DD",
    "billing_period": { 
        "start": "YYYY-MM-DD", 
        "end": "YYYY-MM-DD" 
    },
    "currency": "ISO_4217",
    "total_amount_with_tax": float,
    "total_amount_net": float
  },
  "ai_analysis": {
    "strategy": "ELEC|GAS|LOGISTICS|FLEET|WASTE_PAPER",
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
}`;

    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ 
            role: "user", 
            content: `Analyze this invoice: ${summary}. Hints: ${JSON.stringify(queryHints)}` 
        }],
        temperature: 0
    };

    const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        body: JSON.stringify(payload)
    });

    const response = await client.send(command);
    const rawRes = JSON.parse(new TextDecoder().decode(response.body));
    return JSON.parse(rawRes.content[0].text);
};