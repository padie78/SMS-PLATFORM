import type {
  InvoiceAiAnalysisResult,
  InvoiceAiEmissionLine,
  InvoiceAiTotalAmount,
  InvoiceEmissionCalculations
} from '../../../use-cases/invoice/types/invoice-ai-analysis.types.js';
import type {
  InvoiceGoldenRecord,
  InvoiceGoldenRecordExtractedData
} from '../../../use-cases/invoice/types/invoice-golden-record.types.js';

const ANOMALY_UNIT_PRICE_THRESHOLD = 0.25;
const DEFAULT_CONFIDENCE = 0.85;

const isTotalAmountObject = (
  amount: InvoiceAiTotalAmount | number | undefined
): amount is InvoiceAiTotalAmount => typeof amount === 'object' && amount !== null;

const numberOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumKwhConsumption = (lines: ReadonlyArray<InvoiceAiEmissionLine>): number =>
  lines
    .filter((line) => line.unit?.toLowerCase().includes('kwh') ?? false)
    .reduce((sum, line) => sum + numberOrZero(line.value), 0);

const findMainKwhUnit = (lines: ReadonlyArray<InvoiceAiEmissionLine>): string =>
  lines.find((line) => line.unit?.toLowerCase().includes('kwh'))?.unit ?? 'kWh';

export interface BuildInvoiceGoldenRecordInput {
  readonly orgId: string;
  readonly sk: string;
  readonly aiAnalysis: InvoiceAiAnalysisResult;
  readonly emissions: InvoiceEmissionCalculations;
  readonly status: string;
  readonly category: string;
  readonly originalMetadata?: Record<string, unknown>;
}

/**
 * Mapper puro: transforma el output del analizador IA en el Golden Record persistido.
 *
 * Reglas conservadas del comportamiento original:
 *  - PK normalizada (sin prefijo `ORG#`).
 *  - `analytics.anomaly_detected` cuando el precio unitario excede el umbral.
 *  - `climatiq_result` queda vacío si no hay cálculo de huella todavía.
 */
export function buildInvoiceGoldenRecord(input: BuildInvoiceGoldenRecordInput): InvoiceGoldenRecord {
  const now = new Date().toISOString();
  const cleanPK = input.orgId.replace('ORG#', '');

  const source = input.aiAnalysis.source_data ?? {};
  const billing = source.billing_period ?? {};
  const technical = input.aiAnalysis.technical_ids ?? {};

  const totalAmount = isTotalAmountObject(source.total_amount)
    ? numberOrZero(source.total_amount.total_with_tax)
    : numberOrZero(source.total_amount);

  const emissionLines = input.aiAnalysis.emission_lines ?? [];
  const totalConsumption = sumKwhConsumption(emissionLines);
  const mainUnit = findMainKwhUnit(emissionLines);
  const unitPrice = totalConsumption > 0 ? totalAmount / totalConsumption : 0;

  const extractedData: InvoiceGoldenRecordExtractedData = {
    billing_period: {
      start: billing.start ?? source.invoice_date ?? now.slice(0, 10),
      end: billing.end ?? source.invoice_date ?? now.slice(0, 10)
    },
    invoice_date: source.invoice_date ?? now.slice(0, 10),
    invoice_number: source.invoice_number ?? 'SIN-NUMERO',
    total_amount: totalAmount,
    vendor: source.vendor?.name ?? 'Unknown',
    VENDOR_TAX_ID: source.vendor?.tax_id ?? 'UNKNOWN'
  };

  const climatiqResult: InvoiceGoldenRecord['climatiq_result'] = {
    co2e: numberOrZero(input.emissions.co2e ?? input.emissions.total_kg),
    co2e_unit: input.emissions.co2e_unit ?? 'kg',
    timestamp: now
  };

  const cleanMetadata = (input.originalMetadata ?? {}) as Record<string, unknown>;
  return {
    PK: cleanPK,
    SK: input.sk,
    ai_analysis: {
      activity_id: input.emissions.activity_id ?? 'unknown_activity',
      calculation_method: 'consumption_based',
      confidence_score: numberOrZero(input.aiAnalysis.confidence_score) || DEFAULT_CONFIDENCE,
      requires_review: unitPrice > ANOMALY_UNIT_PRICE_THRESHOLD,
      service_type: input.category || 'ELECTRICITY',
      value: totalConsumption,
      unit: mainUnit,
      year: Number(input.aiAnalysis.analytics_metadata?.year ?? new Date(now).getUTCFullYear())
    },
    analytics_dimensions: {
      asset_id: technical.meter_id ?? technical.cups ?? 'UNKNOWN',
      branch_id: String(input.aiAnalysis.analytics_metadata?.facility_id ?? 'UNKNOWN'),
      period_month: Number(input.aiAnalysis.analytics_metadata?.month ?? new Date(now).getUTCMonth() + 1),
      period_year: Number(input.aiAnalysis.analytics_metadata?.year ?? new Date(now).getUTCFullYear()),
      sector: String(input.aiAnalysis.analytics_metadata?.sector ?? 'UNKNOWN')
    },
    climatiq_result: climatiqResult,
    extracted_data: extractedData,
    metadata: {
      ...cleanMetadata,
      s3_key: typeof cleanMetadata.s3_key === 'string' ? cleanMetadata.s3_key : '',
      status: 'PROCESSED',
      technical_hash: String(cleanMetadata.technical_hash ?? 'unknown'),
      thought_process: {
        detected_raw_values: emissionLines.map((line) => `${line.value} ${line.unit ?? ''}`.trim()),
        missing_data_strategy: String(
          input.aiAnalysis.audit_thought_process?.missing_data_strategy ??
            'No missing data strategy reported by model.'
        ),
        monetary_vs_physical_check: String(
          input.aiAnalysis.audit_thought_process?.monetary_vs_physical_check ??
            'Physical and monetary lines were reviewed by the invoice analyzer.'
        )
      },
      upload_date: String(cleanMetadata.upload_date ?? now)
    },
    processed_at: now,
    total_days_prorated: 0
  };
}
