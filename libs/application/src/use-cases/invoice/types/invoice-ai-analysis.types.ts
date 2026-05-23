/**
 * Tipos compartidos del análisis IA producido por el adaptador Bedrock y
 * consumidos por el use case ProcessInvoicePipeline.
 *
 * El shape replica el contrato emitido por el system prompt del modelo
 * (ver `bedrock-invoice-prompt.ts` en infraestructura). Los campos opcionales
 * reflejan que el LLM puede omitir secciones cuando no aplican.
 */

export interface InvoiceAiSourceVendor {
  readonly name?: string;
  readonly tax_id?: string;
  readonly address?: string;
}

export interface InvoiceAiSourceCustomer {
  readonly name?: string;
  readonly tax_id?: string;
  readonly address?: string;
}

export interface InvoiceAiBillingPeriod {
  readonly start?: string;
  readonly end?: string;
}

export interface InvoiceAiTotalAmount {
  readonly total_with_tax?: number;
  readonly net_amount?: number;
  readonly tax_amount?: number;
}

export interface InvoiceAiSourceData {
  readonly vendor?: InvoiceAiSourceVendor;
  readonly customer?: InvoiceAiSourceCustomer;
  readonly invoice_number?: string;
  readonly invoice_date?: string;
  readonly date?: string;
  readonly billing_period?: InvoiceAiBillingPeriod;
  readonly currency?: string;
  readonly total_amount?: InvoiceAiTotalAmount | number;
  readonly net_amount?: number;
  readonly tax_amount?: number;
}

export interface InvoiceAiTechnicalIds {
  readonly cups?: string;
  readonly contract_reference?: string;
  readonly contracted_power_p1?: number;
  readonly contracted_power_p2?: number;
  readonly meter_id?: string;
  readonly tariff?: string;
}

export interface InvoiceAiEmissionLine {
  readonly strategy?: string;
  readonly description?: string;
  readonly value: number;
  readonly unit?: string;
  readonly monetary_cost?: number;
  readonly confidence_score: number;
  readonly reasoning?: string;
  readonly category?: string;
  readonly period?: { readonly start?: string; readonly end?: string };
}

export interface InvoiceAiAnalyticsMetadata {
  readonly category?: string;
  readonly scope?: string;
  readonly [key: string]: unknown;
}

/** Resultado completo emitido por el LLM tras el análisis estructurado. */
export interface InvoiceAiAnalysisResult {
  readonly audit_thought_process?: Record<string, unknown>;
  readonly confidence_score?: number;
  readonly source_data?: InvoiceAiSourceData;
  readonly analytics_metadata?: InvoiceAiAnalyticsMetadata;
  readonly emission_lines?: ReadonlyArray<InvoiceAiEmissionLine>;
  readonly technical_ids?: InvoiceAiTechnicalIds;
  readonly category?: string;
}

/** Resultado del cálculo de huella (Climatiq u otros motores). */
export interface InvoiceEmissionCalculations {
  readonly total_kg?: number;
  readonly co2e?: number;
  readonly co2e_unit?: string;
  readonly activity_id?: string;
  readonly items?: ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
}
