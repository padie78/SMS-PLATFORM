/**
 * Shape del Golden Record que el use case ProcessInvoicePipeline persiste
 * en DynamoDB vía `IInvoiceGoldenRecordRepository`. Replica el contrato
 * emitido por `buildInvoiceGoldenRecord` y consumido por la UI.
 */

export interface InvoiceGoldenRecordAnalytics {
  readonly confidence_score: number;
  readonly anomaly_detected: boolean;
}

export interface InvoiceGoldenRecordAiAnalysis {
  readonly service_type: string;
  readonly value: number;
  readonly unit: string;
  readonly status_triage: 'DONE' | 'IN_QUEUE' | 'FAILED';
}

export interface InvoiceGoldenRecordClimatiqResult {
  readonly co2e?: number;
  readonly co2e_unit?: string;
  readonly activity_id?: string;
  readonly timestamp?: string;
}

export interface InvoiceGoldenRecordContractedPower {
  readonly p1: number | null;
  readonly p2: number | null;
}

export interface InvoiceGoldenRecordBillingPeriod {
  readonly start: string | null;
  readonly end: string | null;
}

export interface InvoiceGoldenRecordExtractedData {
  readonly invoice_number: string | null;
  readonly invoice_date: string | null;
  readonly vendor: string;
  readonly customer: Record<string, unknown>;
  readonly cups: string | null;
  readonly contract_reference: string | null;
  readonly contracted_power: InvoiceGoldenRecordContractedPower;
  readonly tariff: string | null;
  readonly total_amount: number;
  readonly tax_amount: number;
  readonly net_amount: number;
  readonly currency: string;
  readonly billing_period: InvoiceGoldenRecordBillingPeriod;
  readonly lines: ReadonlyArray<unknown>;
}

export interface InvoiceGoldenRecordMetadata {
  readonly s3_key: string | null;
  readonly is_draft: boolean;
  readonly [key: string]: unknown;
}

export interface InvoiceGoldenRecord {
  readonly PK: string;
  readonly SK: string;
  readonly status: string;
  readonly processed_at: string;
  readonly updated_at: string;
  readonly analytics: InvoiceGoldenRecordAnalytics;
  readonly ai_analysis: InvoiceGoldenRecordAiAnalysis;
  readonly climatiq_result: InvoiceGoldenRecordClimatiqResult | Record<string, never>;
  readonly extracted_data: InvoiceGoldenRecordExtractedData;
  readonly metadata: InvoiceGoldenRecordMetadata;
}
