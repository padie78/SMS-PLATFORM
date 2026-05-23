import { CATEGORY_RULES, type InvoiceCategoryKey, type InvoiceCategoryRule } from './bedrock-invoice-rules.js';

const buildAnalyticsMetadataSchema = (
  category: InvoiceCategoryKey,
  rule: InvoiceCategoryRule
): Record<string, string> => ({
  year: 'int (extracted from invoice_date or period)',
  month: 'int (1-12)',
  quarter: 'string (Q1|Q2|Q3|Q4)',
  is_adjustment: 'boolean',
  facility_id: 'string',
  facility_name: 'string',
  business_unit: 'string',
  country_code: 'string (ISO_2)',
  scope: rule.scope,
  category,
  resource_type: 'string (RENEWABLE|FOSSIL|RECYCLED)',
  ghg_protocol_category: 'string',
  occupancy_hint: 'float (m2 or employees)',
  is_estimated: 'boolean',
  confidence_level: 'string (HIGH|MEDIUM|LOW)',
  anomaly_flag: 'boolean',
  service_id: 'string (Meter/Contract ID/CUPS/Reference)',
  contract_type: 'string (FIXED|INDEXED|Tarifa e.g. 2.0TD)',
  is_recurring: 'boolean',
  reading_type: 'string (ACTUAL|ESTIMATED|CORRECTION)',
  verification_status: 'string (PENDING_AUTOMATED)'
});

const isInvoiceCategoryKey = (value: string): value is InvoiceCategoryKey =>
  Object.prototype.hasOwnProperty.call(CATEGORY_RULES, value);

/**
 * Construye el system prompt parametrizado por categoría usado por Bedrock
 * Claude Haiku para el análisis estructurado de la factura.
 */
export function buildBedrockInvoiceSystemPrompt(category: string): string {
  const safeCategory: InvoiceCategoryKey = isInvoiceCategoryKey(category) ? category : 'OTHERS';
  const rule = CATEGORY_RULES[safeCategory];

  const fullSchema = {
    audit_thought_process: {
      table_row_count: 'Exact number of rows identified in the billing table',
      header_scan_results: 'Brief summary of found CUPS, CIF, and Contract Reference',
      financial_extraction_map:
        'Step-by-step logic to identify Net Amount (Base Imponible) and Tax (IVA)',
      atomic_line_inventory: 'Confirmation of every line item found (P1, P2, P3, Taxes, Fees)'
    },
    confidence_score: 'float (0.0-1.0 reporting your overall certainty of the extraction)',
    source_data: {
      vendor: { name: 'string', tax_id: 'string (CIF)', address: 'string' },
      customer: {
        name: 'string (Titular)',
        tax_id: 'string (CIF/NIF)',
        address: 'string (Suministro/Fiscal address)'
      },
      invoice_number: 'string',
      invoice_date: 'YYYY-MM-DD',
      billing_period: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
      currency: 'string (ISO_4217)',
      total_amount: {
        total_with_tax: 'float',
        net_amount: 'float (Base Imponible)',
        tax_amount: 'float (Total IVA)'
      }
    },
    analytics_metadata: buildAnalyticsMetadataSchema(safeCategory, rule),
    emission_lines: [
      {
        strategy: rule.strategy,
        description: "Original line text (e.g., 'Energía Activa P1' or 'Impuesto Eléctrico')",
        value: 'float (Physical quantity or 0 for taxes/fees)',
        unit: 'string (kWh, kW, kW/día, EUR)',
        monetary_cost: 'float',
        confidence_score: 'float',
        reasoning: 'Detailed proof: why this line was included',
        period: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
      }
    ],
    technical_ids: {
      cups: 'string (ES...)',
      contract_reference: 'string (Referencia Contrato)',
      contracted_power_p1: 'float (kW)',
      contracted_power_p2: 'float (kW)',
      meter_id: 'string',
      tariff: 'string (e.g., 2.0TD)'
    }
  };

  const elecGuidance =
    safeCategory === 'ELEC'
      ? '- Mandatory: Extract P1, P2, and P3 separately. Do not merge Energy with Power capacity.'
      : '';

  return `You are a Senior ESG Data Auditor. Your mission is high-precision digitization of utility invoices.

### THE "MASTER DATA & HEADER" PROTOCOL:
1. **HEADER SCAN**: Before looking at costs, locate Supply Details:
   - **CUPS**: Mandatory string starting with 'ES'.
   - **REFERENCIA**: Locate 'Referencia Contrato' (e.g., 9988776655) and map to 'technical_ids.contract_reference'.
   - **POTENCIA**: Locate 'Potencia Contratada' for P1 and P2 (e.g., 5.5 kW) and map to 'technical_ids.contracted_power_p1/p2'.
   - **CIF/NIF**: Identify the Customer/Titular Tax ID.

### THE "ATOMIC EXTRACTION" PROTOCOL:
1. **FULL TABLE REPLICATION**: You MUST extract EVERY row from the invoice detail table. If the table has 7 lines, return 7 objects in 'emission_lines'.
2. **ZERO-VALUE INCLUSION**: Do not skip lines with 0.0 value or 0.0 cost.
3. **TAXES & FEES**: Include rows like 'Impuesto Eléctrico' or 'Alquiler de equipos'. Map them using 'EUR' as unit if no physical unit is present.
4. **POWER VS ENERGY**: For ELEC, distinguish "Potencia" (kW) from "Energía" (kWh). Both are required.

### CATEGORY GUIDANCE (${safeCategory}):
${elecGuidance}

### NEGATIVE CONSTRAINTS:
- DO NOT summarize or consolidate the table. 
- NEVER map currency to the "value" field.
- Return ONLY valid JSON.

### REQUIRED SCHEMA:
${JSON.stringify(fullSchema, null, 2)}`;
}
