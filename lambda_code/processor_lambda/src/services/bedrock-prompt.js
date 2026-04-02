// 1. Importación obligatoria con extensión .js
import { CATEGORY_RULES } from './bedrock-rules.js';

/**
 * Genera el esquema de analytics_metadata inyectando valores fijos de la regla.
 */
const getAnalyticsMetadataSchema = (category, rule) => {
    return {
        year: "int", month: "MM", quarter: "Q1|Q2|Q3|Q4",
        is_adjustment: "boolean",
        facility_id: "string", facility_name: "string",
        business_unit: "string", country_code: "ISO_2",
        scope: rule.scope,      // Prefilled dinámicamente desde la regla
        category: category,     // Prefilled dinámicamente
        resource_type: "RENEWABLE|FOSSIL|RECYCLED",
        ghg_protocol_category: "string",
        occupancy_hint: "float (m2 or employees)",
        is_estimated: "boolean",
        confidence_level: "HIGH|MEDIUM|LOW",
        anomaly_flag: "boolean",
        service_id: "string (Meter/Contract ID)",
        contract_type: "FIXED|INDEXED",
        is_recurring: "boolean",
        reading_type: "ACTUAL|ESTIMATED|CORRECTION",
        verification_status: "PENDING_AUTOMATED"
    };
};

/**
 * Construye el System Prompt dinámico inyectando el esquema JSON esperado.
 * Exportación nombrada para mayor claridad.
 */
export const buildSystemPrompt = (category) => {
    const rule = CATEGORY_RULES[category] || CATEGORY_RULES.OTHERS;

    const fullSchema = {
        source_data: {
            vendor: { name: "string", tax_id: "string", address: "string" },
            invoice_number: "string",
            invoice_date: "YYYY-MM-DD",
            billing_period: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
            currency: "ISO_4217",
            total_amount: { total_with_tax: "float", net: "float" }
        },
        analytics_metadata: getAnalyticsMetadataSchema(category, rule),
        emission_lines: [
            {
                strategy: rule.strategy,
                description: "string",
                value: "float",
                unit: "string",
                confidence_score: "float",
                reasoning: "string",
                period: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
                metadata: rule.metadata // Inyección dinámica de campos específicos según categoría
            }
        ]
    };

    return `You are a Senior ESG Data Auditor. Mission: Extract data for a DynamoDB Single-Table SMS.
            ### CATEGORY CONTEXT:
            Auditing a ${category} invoice. Focus: ${rule.focus}

            ### CORE OPERATIONAL RULES:
            1. MULTI-ITEM: Separate each emission source into the "emission_lines" array.
            2. ANCHORS: Use QUERY HINTS for financial values and Tax IDs.
            3. TEMPORAL: Extract 'billing_period' and 'invoice_date' (YYYY-MM-DD).
            4. NO PROSE: Output ONLY valid JSON.
            5. DATA TYPES: All numeric fields MUST be float or int, never strings.

            ### REQUIRED OUTPUT SCHEMA:
            ${JSON.stringify(fullSchema, null, 2)}`;
};

// 2. Exportación por defecto para mantener consistencia con los otros servicios
export default { buildSystemPrompt };