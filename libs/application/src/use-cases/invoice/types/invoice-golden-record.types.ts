export interface InvoiceGoldenRecordAiAnalysis {
  readonly activity_id: string;
  readonly calculation_method: 'consumption_based' | 'spend_based' | 'fuel_based';
  readonly confidence_score: number;
  readonly requires_review: boolean;
  readonly service_type: string;
  readonly unit: string;
  readonly value: number;
  readonly year: number;
}

export interface InvoiceGoldenRecordAnalyticsDimensions {
  readonly asset_id: string;
  readonly branch_id: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly sector: string;
}

export interface InvoiceGoldenRecordClimatiqResult {
  readonly co2e: number;
  readonly co2e_unit: string;
  readonly timestamp: string;
}

export interface InvoiceGoldenRecordBillingPeriod {
  readonly start: string;
  readonly end: string;
}

export interface InvoiceGoldenRecordExtractedData {
  readonly billing_period: InvoiceGoldenRecordBillingPeriod;
  readonly invoice_date: string;
  readonly invoice_number: string;
  readonly total_amount: number;
  readonly vendor: string;
  readonly VENDOR_TAX_ID: string;
}

export interface InvoiceGoldenRecordThoughtProcess {
  readonly detected_raw_values: ReadonlyArray<string>;
  readonly missing_data_strategy: string;
  readonly monetary_vs_physical_check: string;
}

export interface InvoiceGoldenRecordMetadata {
  readonly s3_key: string;
  readonly status: 'PROCESSED';
  readonly technical_hash: string;
  readonly thought_process: InvoiceGoldenRecordThoughtProcess;
  readonly upload_date: string;
  readonly [key: string]: unknown;
}

/**
 * Golden Record analítico final.
 *
 * El lifecycle conserva META/EXTRACTION/AUDIT por separado; este item queda
 * denormalizado para dashboards ESG, queries de BI y exportación operacional.
 */
export interface InvoiceGoldenRecord {
  readonly PK: string;
  readonly SK: string;
  readonly ai_analysis: InvoiceGoldenRecordAiAnalysis;
  readonly analytics_dimensions: InvoiceGoldenRecordAnalyticsDimensions;
  readonly climatiq_result: InvoiceGoldenRecordClimatiqResult;
  readonly extracted_data: InvoiceGoldenRecordExtractedData;
  readonly metadata: InvoiceGoldenRecordMetadata;
  readonly processed_at: string;
  readonly total_days_prorated: number;
}
