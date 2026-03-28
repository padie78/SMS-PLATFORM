const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({ region: "eu-central-1" });

/**
 * Pipeline de Normalización con IA (Sistema de Gestión de Sostenibilidad)
 */
exports.entenderConIA = async (summary, queryHints) => {
    const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

    // ... (systemPrompt se mantiene igual)

    const userPrompt = `Analiza este documento para contabilidad de carbono:
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
        // --- LOG DE ENTRADA ---
        console.log("=== [BEDROCK_INPUT_START] ===");
        console.log(`Modelo: ${modelId}`);
        console.log("Payload enviado a Bedrock:", JSON.stringify({
            queryHints,
            summaryLength: summary.length,
            modelParams: { temperature: bodyPayload.temperature, max_tokens: bodyPayload.max_tokens }
        }, null, 2));
        // Opcional: console.log("System Prompt:", systemPrompt); // Solo si necesitas debuggear el prompt largo
        console.log("=== [BEDROCK_INPUT_END] ===");

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

        // --- LOG DE SALIDA (RAW) ---
        console.log("=== [BEDROCK_OUTPUT_START] ===");
        console.log(`Latencia: ${duration}ms`);
        console.log("Respuesta cruda de la IA:", contentText);

        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("❌ ERROR: La IA no incluyó un bloque JSON en su respuesta.");
            throw new Error("La IA no devolvió un JSON válido");
        }
        
        const finalResult = JSON.parse(jsonMatch[0]);

        // Sanitización final de datos
        validarYLimpiarResultado(finalResult);

        // --- LOG DE RESULTADO FINAL ---
        console.log("Resultado final normalizado:", JSON.stringify(finalResult, null, 2));
        console.log("=== [BEDROCK_OUTPUT_END] ===");

        return finalResult;

    } catch (error) {
        console.error("🚨 [BEDROCK_PIPELINE_ERROR]:", error.message);
        if (error.stack) console.error("Stack Trace:", error.stack);
        throw new Error(`Fallo en la Normalización de IA: ${error.message}`);
    }
};