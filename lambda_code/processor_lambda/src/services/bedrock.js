import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Configuración del cliente con optimización para la región de tu preferencia
const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
    maxAttempts: 3
});

/**
 * Servicio de Auditoría GenAI (Claude 3 Haiku).
 * Realiza Clasificación + Extracción en un solo paso (Zero-Shot).
 */
export const analyzeInvoice = async (rawText) => {
    console.log(`   [BEDROCK_START]: Analizando texto crudo (${rawText.length} caracteres)...`);

    const systemPrompt = `
You are a Senior ESG Data Auditor. 
Your task is to analyze the raw OCR text of an invoice, identify its category, and extract all relevant data for a Sustainability Management System (SMS).

### STEP 1: CLASSIFY
Identify the category from this list: [ELEC, GAS, WATER, WASTE, LOGISTICS, REFRIGERANTS, FLEET, FLIGHTS, OTHERS].

### STEP 2: CATEGORY-SPECIFIC FOCUS
- ELEC/GAS: Extract CUPS/Meter ID and total consumption (kWh/m3).
- WASTE: Extract waste type (paper, plastic) and weight (kg/t).
- LOGISTICS/FLEET: Extract vehicle ID/Plate and distance (km) or fuel (L).
- REFRIGERANTS: Extract gas type (R-32, R-410A) and recharge weight (kg).

### CORE OPERATIONAL RULES:
1. OUTPUT: Return ONLY a valid JSON object. DO NOT include introductions, "Here is your JSON", or conclusions.
2. DATES: Format as YYYY-MM-DD.
3. NUMBERS: Use floats/integers, never strings for numeric values.
4. LANGUAGE: Translate conceptual meaning to English for JSON keys, but keep proper names (Vendor, Customer) as found in the text.

### REQUIRED OUTPUT SCHEMA:
{
  "category": "ELEC|GAS|WATER|WASTE|LOGISTICS|REFRIGERANTS|FLEET|FLIGHTS|OTHERS",
  "extracted_data": {
    "vendor": { "name": "string", "tax_id": "string", "address": "string" },
    "customer": { "name": "string", "tax_id": "string" },
    "invoice": { "number": "string", "date": "YYYY-MM-DD" },
    "period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "amounts": { "total": "float", "net": "float", "tax": "float", "currency": "ISO_4217" },
    "location": { "country": "ISO_2", "postal_code": "string", "address": "string" }
  },
  "emission_lines": [
    {
        "activity_id": "string",
        "description": "Short description of the line item",
        "value": "float",
        "unit": "string",
        "period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
    }
  ],
  "technical_ids": { "cups": "string", "meter_id": "string", "plate": "string" }
}`;

    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2500,
        temperature: 0,
        system: systemPrompt,
        messages: [
            {
                role: "user",
                content: [{ type: "text", text: `RAW OCR TEXT TO ANALYZE:\n${rawText}` }]
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

        // --- FILTRO DE SEGURIDAD PARA JSON ---
        // Buscamos el primer '{' y el último '}' para ignorar cualquier texto extra (prosa)
        const jsonStart = resultText.indexOf('{');
        const jsonEnd = resultText.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1) {
            console.error("❌ [BEDROCK_INVALID_OUTPUT]: La respuesta no contiene un objeto JSON válido.");
            throw new Error("No JSON object found in Bedrock response.");
        }

        const cleanJson = resultText.substring(jsonStart, jsonEnd + 1);
        const finalData = JSON.parse(cleanJson);

        console.log(`   [BEDROCK_END]: Categoría detectada: ${finalData.category} | Vendor: ${finalData.extracted_data?.vendor?.name || 'N/A'}`);
        
        return finalData;

    } catch (error) {
        console.error(`❌ [BEDROCK_CRITICAL_ERROR]:`, error.message);
        // Si el error es de JSON.parse, lanzamos un error descriptivo
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse AI response as JSON: ${error.message}`);
        }
        throw new Error(`AI Analysis failed: ${error.message}`);
    }
};

export default { analyzeInvoice };