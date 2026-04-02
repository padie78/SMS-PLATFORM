import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
    maxAttempts: 3
});

/**
 * Servicio de Auditoría GenAI (Claude 3 Haiku).
 * Adaptado para inyectar 'category' en cada línea de emisión para el Mapper de Climatiq.
 */
export const analyzeInvoice = async (rawText) => {
    console.log(`   [BEDROCK_START]: Analizando texto crudo (${rawText.length} caracteres)...`);

    const systemPrompt = `
You are a Senior ESG Data Auditor. 
Your task is to analyze the raw OCR text of an invoice and extract data for a Sustainability Management System (SMS).

### STEP 1: CLASSIFY
Identify the main category: [ELEC, GAS, WATER, WASTE_PAPER, WASTE_MIXED, LOGISTICS, REFRIGERANTS, FLEET, CLOUDOPS, HOTEL].

### STEP 2: EMISSION LINES MAPPING (CRITICAL)
For each consumption line found, you MUST include a "category" field that matches one of these keys exactly:
- ELEC (Electricity)
- GAS (Natural Gas)
- WATER (Water consumption)
- WASTE_PAPER (Paper recycling)
- WASTE_MIXED (General waste)
- LOGISTICS (Third-party transport)
- FLEET (Own fleet/Fuel)
- REFRIGERANTS (F-Gases)
- HOTEL (Business travel stay)
- CLOUDOPS (Cloud services)

### CORE OPERATIONAL RULES:
1. OUTPUT: Return ONLY a valid JSON object. No preamble.
2. DATES: YYYY-MM-DD.
3. NUMBERS: Use floats/integers.
4. UNITS: Use standard units (kWh, m3, kg, km, EUR, USD).

### REQUIRED OUTPUT SCHEMA:
{
  "category": "MAIN_CATEGORY_HERE",
  "extracted_data": {
    "vendor": { "name": "string", "tax_id": "string" },
    "invoice": { "number": "string", "date": "YYYY-MM-DD" },
    "total_amount": { "total": "float", "currency": "ISO_4217" },
    "location": { "country": "ISO_2" }
  },
  "emission_lines": [
    {
        "category": "ELEC|GAS|WATER|WASTE_PAPER|etc", 
        "description": "Specific line item description",
        "value": "float",
        "unit": "string"
    }
  ],
  "technical_ids": { "cups": "string", "meter_id": "string" }
}`;

    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2500,
        temperature: 0,
        system: systemPrompt,
        messages: [
            {
                role: "user",
                content: [{ type: "text", text: `RAW OCR TEXT:\n${rawText}` }]
            }
        ]
    };

    try {
        const command = new InvokeModelCommand({
            modelId: "anthropic.claude-3-haiku-20240307-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload)
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        let resultText = responseBody.content[0].text.trim();

        // Limpieza de JSON (Haiku a veces añade pequeñas explicaciones)
        const jsonStart = resultText.indexOf('{');
        const jsonEnd = resultText.lastIndexOf('}');
        if (jsonStart === -1) throw new Error("No JSON found");

        const finalData = JSON.parse(resultText.substring(jsonStart, jsonEnd + 1));

        console.log(`   [BEDROCK_END]: Detectadas ${finalData.emission_lines?.length || 0} líneas de emisión.`);
        
        return finalData;

    } catch (error) {
        console.error(`❌ [BEDROCK_ERROR]:`, error.message);
        throw error;
    }
};

export default { analyzeInvoice };