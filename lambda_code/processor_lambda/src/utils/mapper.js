import crypto from "node:crypto";

/**
 * Transforma los resultados de IA y Cálculos en el esquema de DynamoDB para el SMS.
 * Soporta múltiples líneas de emisión y metadatos de auditoría.
 */
export const buildGoldenRecord = (orgId, key, ai, calc) => {
    const now = new Date().toISOString();
    const fileHash = crypto.createHash('sha256').update(key).digest('hex');
    
    // Desestructuración de los datos que extrajo Bedrock
    const { year, month, facility_id, country_code, category, business_unit } = ai.analytics_metadata;
    const { vendor, invoice_number, currency, amounts } = ai.source_data;

    return {
        PK: `ORG#${orgId}`,
        // SK única: Tipo # Fecha # Hash_Corto para trazabilidad
        SK: `INV#${year}#${month}#${fileHash.substring(0, 8)}`,
        
        analytics_dims: {
            year: parseInt(year) || new Date().getFullYear(),
            month: month || "01",
            quarter: month ? `Q${Math.ceil(parseInt(month) / 3)}` : "Q1",
            facility_id: facility_id || "UNKNOWN_PLANT",
            country_code: country_code || "ISO",
            business_unit: business_unit || "General",
            category: category || "OTHER",
            scope: ai.analytics_metadata.scope || 'SCOPE_3'
        },

        metrics: {
            co2e_tons: calc.total_tons || 0,
            consumption_value: amounts?.net || 0,
            consumption_unit: ai.emission_lines[0]?.unit || "unit",
            // Ratio de intensidad: CO2 por cada unidad de moneda gastada
            intensity_metric: amounts?.net > 0 ? (calc.total_tons / amounts.net) : 0,
            is_anomaly: ai.analytics_metadata.anomaly_flag || false
        },

        audit_trail: {
            uploaded_by: "SYSTEM_PIPELINE_V2",
            created_at: now,
            hash_integrity: fileHash,
            // Si la IA tiene baja confianza, marcamos para revisión humana
            is_manual_review_required: ai.emission_lines.some(l => l.confidence_score < 0.7),
            bedrock_model: "claude-3-haiku-20240307"
        },

        source_data: {
            vendor_name: vendor?.name || "Desconocido",
            vendor_tax_id: vendor?.tax_id || "N/A",
            invoice_number: invoice_number || "N/A",
            currency: currency || "EUR",
            s3_key: key,
            billing_period: ai.source_data.billing_period
        },

        emission_items: calc.items || []
    };
};

// 2. Exportación por defecto para que 'import mapper from ...' funcione
export default { buildGoldenRecord };