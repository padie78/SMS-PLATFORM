// 1. Importaciones con sintaxis ESM y extensiones .js obligatorias
import textract from "./services/textract.js";
import classifier from "./services/classifier.js";
import bedrock from "./services/bedrock.js";
import climatiq from "./services/climatiq.js";
import mapper from "./utils/mapper.js";
import db from "./services/db.js";

// 2. Exportación nombrada para el handler de Lambda
export const handler = async (event, context) => { // Añadido 'context' como segundo parámetro
    const startTime = Date.now();
    const record = event.Records[0];
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    // ID de correlación: context.awsRequestId ya viene definido por AWS Lambda
    const requestId = context.awsRequestId || Math.random().toString(36).substring(7);

    console.log(`🚀 [PIPELINE_START] [ID:${requestId}]: Iniciando proceso para s3://${bucket}/${key}`);

    try {
        // --- FASE 1: CLASIFICACIÓN ---
        console.log(`   [1/6] [CLASSIFY_START]: Extrayendo texto base para identificación...`);
        const initialOcr = await textract.extractText(bucket, key, "OTHERS");

        // --- LOGS DE DEPURACIÓN DEL INITIAL_OCR ---
        console.log(`📊 [INITIAL_OCR_SUMMARY]:`);
        console.log(`   - Raw Text Length: ${initialOcr.rawText?.length || 0} caracteres`);
        console.log(`   - Confidence: ${initialOcr.confidence?.toFixed(2)}%`);
        console.log(`   - Fields Found: ${Object.values(initialOcr.queryHints).filter(v => v !== null).length} campos`);

        // Logueamos los primeros 500 caracteres del texto que se le enviará al Classifier
        console.log(`📝 [CLASSIFIER_INPUT_PREVIEW]: "${initialOcr.rawText?.substring(0, 500).replace(/\n/g, ' ')}..."`);
        
        const category = await classifier.identifyCategory(initialOcr.rawText);
        console.log(`   [1/6] [CLASSIFY_END]: Categoría resuelta -> ${category}`);


        // --- FASE 2: EXTRACCIÓN ESPECÍFICA ---
        console.log(`   [2/6] [TEXTRACT_START]: Ejecutando Queries específicas para ${category}...`);
        const fullOcr = await textract.extractText(bucket, key, category);

        // --- LOGS DE COMPARACIÓN Y DEPURACIÓN ---
        const totalQueries = Object.keys(fullOcr.queryHints || {}).length;
        const foundFields = Object.values(fullOcr.queryHints || {}).filter(v => v !== null).length;
        const hitRate = ((foundFields / totalQueries) * 100).toFixed(1);

        console.log(`📊 [FULL_OCR_REPORT] [CAT: ${category}]:`);
        console.log(`   - Detección: ${foundFields}/${totalQueries} campos (${hitRate}%)`);
        console.log(`   - Confidence Global: ${fullOcr.confidence?.toFixed(2)}%`);

        // Logueamos los resultados de las queries específicas para ver si detectó los KPIs
        console.log(`🔍 [SPECIFIC_DATA_HINTS]:`, {
            CUPS: fullOcr.queryHints?.CUPS || "❌ NOT_FOUND",
            KWH: fullOcr.queryHints?.KWH_CONSUMPTION || "❌ NOT_FOUND",
            TOTAL: fullOcr.queryHints?.TOTAL_AMOUNT || "❌ NOT_FOUND"
        });

        if (hitRate < 30) {
            console.warn(`⚠️  [LOW_EXTRACTION_WARNING]: Muy pocos campos detectados. Revisa el layout de la factura en s3://${bucket}/${key}`);
        }

        const qCount = Object.keys(fullOcr.queryHints || {}).length;
        console.log(`   [2/6] [TEXTRACT_END]: Extracción completada. Campos detectados: ${qCount}`);


        // --- FASE 3: ANÁLISIS SEMÁNTICO (BEDROCK) ---
        console.log(`   [3/6] [BEDROCK_START]: Validando coherencia y limpiando OCR...`);
        const aiAnalysis = await bedrock.analyzeInvoice(fullOcr);

                // --- LOGS DE DEPURACIÓN DE LA IA ---
        console.log(`✨ [AI_ANALYSIS_SUCCESS]:`);
        console.log(`   - Modelo: ${aiAnalysis.audit_metadata?.model_id || "claude-3-haiku"}`);
        console.log(`   - Categoría Confirmada: ${aiAnalysis.analytics_metadata?.category || "UNKNOWN"}`);
        console.log(`   - Confianza Promedio: ${(aiAnalysis.audit_metadata?.confidence_avg * 100).toFixed(2)}%`);

        // Verificamos si la IA detectó que falta información crítica
        const missingFields = aiAnalysis.audit_metadata?.missing_fields || [];
        if (missingFields.length > 0) {
            console.warn(`⚠️  [AI_DATA_GAP]: La IA no pudo encontrar: ${missingFields.join(", ")}`);
        }

        // Logueamos el desglose de líneas de emisión (vital para el SMS)
        if (aiAnalysis.emission_lines && aiAnalysis.emission_lines.length > 0) {
            console.log(`📊 [EMISSION_LINES_DETECTED]: ${aiAnalysis.emission_lines.length} líneas.`);
            console.table(aiAnalysis.emission_lines.map(line => ({
                Concepto: line.concept?.substring(0, 30),
                Cantidad: line.quantity,
                Unidad: line.unit,
                Suministro: line.supply_point || "N/A"
            })));
        }

        // Log del objeto final que irá al Mapper
        console.log(`📦 [AI_FINAL_PAYLOAD_PREVIEW]:`, JSON.stringify({
            vendor: aiAnalysis.source_data?.vendor?.name,
            total: aiAnalysis.source_data?.amounts?.total,
            period: aiAnalysis.source_data?.billing_period
        }, null, 2));

        const vendor = aiAnalysis.extracted_data.vendor.name || "Desconocido";
        console.log(`   [3/6] [BEDROCK_END]: Auditoría IA lista. Proveedor detectado: ${vendor}`);


        // --- FASE 4: CÁLCULO DE HUELLA (CLIMATIQ) ---
        const lineCount = aiAnalysis.emission_lines?.length || 0;
        console.log(`   [4/6] [CLIMATIQ_START]: Calculando CO2 para ${lineCount} líneas de emisión...`);
        const emissionCalculations = await climatiq.calculateEmissions(
            aiAnalysis.emission_lines, 
            aiAnalysis.dims.country
        );
        const totalCo2 = emissionCalculations.reduce((acc, curr) => acc + curr.co2e, 0);
        console.log(`   [4/6] [CLIMATIQ_END]: Cálculo finalizado. Total: ${totalCo2.toFixed(4)} kgCO2e`);


        // --- FASE 5: MAPEO DE DATOS ---
        console.log(`   [5/6] [MAPPER_START]: Construyendo Golden Record para Single-Table Design...`);
        const goldenRecord = mapper.buildGoldenRecord(
            "ORG#98765", 
            key,
            aiAnalysis,
            emissionCalculations
        );
        console.log(`   [5/6] [MAPPER_END]: Mapeo exitoso. SK generado: ${goldenRecord.SK}`);


        // --- FASE 6: PERSISTENCIA ---
        console.log(`   [6/6] [DB_START]: Intentando persistencia transaccional en DynamoDB...`);
        const dbResult = await db.persistTransaction(goldenRecord);
        
        const duration = (Date.now() - startTime) / 1000;

        if (dbResult?.skipped) {
            console.log(`⚠️ [PIPELINE_END] [ID:${requestId}]: Finalizado (Duplicado omitido) en ${duration}s.`);
        } else {
            console.log(`✅ [PIPELINE_END] [ID:${requestId}]: Proceso exitoso en ${duration}s.`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Success", sk: goldenRecord.SK, duration: `${duration}s` })
        };

    } catch (error) {
        const totalDuration = (Date.now() - startTime) / 1000;
        console.error(`❌ [PIPELINE_CRITICAL_FAILURE] [ID:${requestId}] tras ${totalDuration}s:`, error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: error.message,
                requestId: requestId
            })
        };
    }
};