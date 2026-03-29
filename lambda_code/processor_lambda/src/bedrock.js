const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });
const MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * Normalización de tipos de datos para asegurar el contrato JSON.
 */
const validarYLimpiarResultado = (resultado) => {
    const parseNumeric = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const clean = val.replace(/[^\d,.-]/g, '').replace(',', '.');
            const parsed = parseFloat(clean);
            return isNaN(parsed) ? 0.0 : parsed;
        }
        return 0.0;
    };

    if (resultado.extracted_data) {
        resultado.extracted_data.total_amount = parseNumeric(resultado.extracted_data.total_amount);
    }

    if (resultado.ai_analysis) {
        resultado.ai_analysis.value = parseNumeric(resultado.ai_analysis.value);
        resultado.ai_analysis.year = parseInt(resultado.ai_analysis.year) || new Date().getFullYear() - 1;
    }

    if (resultado.climatiq_ready_payload && resultado.climatiq_ready_payload.parameters) {
        const params = resultado.climatiq_ready_payload.parameters;
        Object.keys(params).forEach(key => {
            if (!key.endsWith('_unit')) {
                params[key] = parseNumeric(params[key]);
            }
        });
    }

    return resultado;
};

/**
 * Tu System Prompt Exacto (Sin modificaciones)
 */
const getSystemPrompt = () => `
You are a Senior Sustainability Data Engineer. 
Mission: Act as a deterministic middleware between raw OCR and Climatiq API.

### RULES:
1. NO PROSE: Output ONLY valid JSON.
2. ISO CODES: Country -> ISO 3166-1 alpha-2. Currency -> ISO 4217.
3. PARAMETER LOGIC:
   - service 'elec' or 'gas' -> parameter_type: 'energy'
   - service 'water' or 'fuel' -> parameter_type: 'volume'
   - spend-based -> parameter_type: 'money'

### OUTPUT SCHEMA:
{
  "extracted_data": {
    "vendor": "string",
    "total_amount": float,
    "currency": "ISO_CODE"
  },
  "ai_analysis": {
    "service_type": "elec|gas|water|fuel",
    "year": int,
    "calculation_method": "consumption_based|spend_based",
    "activity_id": "string",
    "parameter_type": "energy|volume|money",
    "value": float,
    "unit": "string",
    "region": "ISO_CODE"
  },
  "climatiq_ready_payload": {
    "activity_id": "string",
    "region": "ISO_CODE",
    "parameters": {
       "DYNAMIC_KEY": float,
       "DYNAMIC_KEY_unit": "string"
    }
  }
}`;

/**
 * Función base de invocación para Bedrock
 */
async function invokeBedrock(summary, queryHints, customInstruction = "") {
    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 3000,
        system: getSystemPrompt(),
        messages: [{ 
            role: "user", 
            content: `${customInstruction}
                      Analyze this document for carbon accounting:
                      QUERY_HINTS: ${JSON.stringify(queryHints)}
                      FULL_SUMMARY: ${summary}` 
        }],
        temperature: 0
    };

    const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload)
    });

    const response = await client.send(command);
    const rawRes = JSON.parse(new TextDecoder().decode(response.body));
    const contentText = rawRes.content[0].text;
    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) throw new Error("Bedrock did not return a valid JSON block.");
    
    return validarYLimpiarResultado(JSON.parse(jsonMatch[0]));
}

/**
 * PASO 1: Para obtener términos de búsqueda y análisis inicial
 */
exports.generarBusquedaSemantica = async (summary, queryHints = {}) => {
    const instruction = "Focus on extracting the most accurate search keywords for the emission factor.";
    const result = await invokeBedrock(summary, queryHints, instruction);
    
    // Agregamos search_query al vuelo basado en el vendor y service_type para el Search API
    return {
        ...result,
        search_query: `${result.extracted_data.vendor} ${result.ai_analysis.service_type}`
    };
};

/**
 * PASO 2: Para extraer el valor basado en la unidad que Climatiq nos confirmó
 */
exports.extraerValorEspecifico = async (summary, unitType, queryHints = {}) => {
    const instruction = `The Climatiq API has confirmed that for this factor it strictly needs a value for: ${unitType}.`;
    const result = await invokeBedrock(summary, queryHints, instruction);
    
    // Devolvemos el objeto mapeado para que external_api.js lo entienda
    return {
        value: result.ai_analysis.value,
        key: result.ai_analysis.parameter_type,
        unit: result.ai_analysis.unit,
        currency: result.extracted_data.currency
    };
};

// Mantenemos la exportación original por si otros módulos la usan
exports.entenderConIA = invokeBedrock;