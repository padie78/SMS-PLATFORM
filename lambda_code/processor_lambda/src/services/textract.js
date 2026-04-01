import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { QUERIES_BY_CATEGORY } from "../constants/extraction_queries.js";

const client = new TextractClient({ 
    region: process.env.AWS_REGION || "eu-central-1",
    maxAttempts: 3 
});

export const extractText = async (bucket, key, category = "OTHERS") => {
    console.log(`🔍 [TEXTRACT_START]: Procesando [${category}] | s3://${bucket}/${key}`);

    const queries = QUERIES_BY_CATEGORY[category] || QUERIES_BY_CATEGORY.OTHERS;

    // --- LOG DE SELECCIÓN DE ESTRATEGIA ---
    console.log(`🎯 [STRATEGY_SELECTION]: Usando queries para la categoría [${category}]`);

    if (!QUERIES_BY_CATEGORY[category]) {
        console.warn(`⚠️  [CATEGORY_FALLBACK]: La categoría '${category}' no existe. Aplicando [OTHERS] por defecto.`);
    }

    // --- DEBUG: QUERIES ENVIADAS ---
    console.log(`--- [DEBUG_SENT_QUERIES] ---`);
    console.table(queries.map(q => ({ Alias: q.Alias, Query: q.Text })));

    const params = {
        Document: {
            S3Object: { Bucket: bucket, Name: key }
        },
        FeatureTypes: ["QUERIES"],
        QueriesConfig: {
            Queries: queries.map(q => ({
                Text: q.Text,
                Alias: q.Alias
            }))
        }
    };

    try {
        const command = new AnalyzeDocumentCommand(params);
        const response = await client.send(command);

        if (!response.Blocks) {
            throw new Error("Textract no devolvió bloques de datos.");
        }

        // 2. Texto Crudo Completo
        const rawText = response.Blocks
            .filter(block => block.BlockType === "LINE")
            .map(block => block.Text)
            .join("\n");

        // --- DEBUG: TEXTO COMPLETO ---
        // Útil para copiar y pegar en un test de Bedrock manualmente
        console.log(`--- [DEBUG_RAW_TEXT_FULL] ---`);
        console.log(rawText);
        console.log(`--- [END_RAW_TEXT] ---`);

        // 3. Mapeo de resultados con Confidence Scores
        const queryHints = {};
        const queryDetails = []; // Para un log más rico
        
        const queryBlocks = response.Blocks.filter(b => b.BlockType === "QUERY");
        const resultBlocks = response.Blocks.filter(b => b.BlockType === "QUERY_RESULT");

        queryBlocks.forEach(qBlock => {
            const alias = qBlock.Query.Alias;
            const relationship = qBlock.Relationships?.find(r => r.Type === "ANSWER");
            
            if (relationship && relationship.Ids.length > 0) {
                const answerBlock = resultBlocks.find(r => relationship.Ids.includes(r.Id));
                if (answerBlock) {
                    queryHints[alias] = answerBlock.Text;
                    queryDetails.push({
                        Field: alias,
                        Value: answerBlock.Text,
                        Confidence: `${answerBlock.Confidence.toFixed(2)}%`
                    });
                }
            } else {
                queryHints[alias] = null;
                queryDetails.push({ Field: alias, Value: "NOT_FOUND", Confidence: "0%" });
            }
        });

        // --- DEBUG: RESULTADOS DETALLADOS ---
        console.log(`--- [DEBUG_EXTRACTION_REPORT] ---`);
        console.table(queryDetails);

        const foundFields = Object.values(queryHints).filter(v => v !== null).length;
        console.log(`✅ [TEXTRACT_SUCCESS]: ${foundFields}/${queries.length} campos detectados.`);

        return {
            rawText,
            queryHints,
            category,
            confidence: response.Blocks[0]?.Confidence || 0
        };

    } catch (error) {
        console.error(`❌ [TEXTRACT_ERROR] en ${key}:`, error.message);
        throw error;
    }
};

export default { extractText };