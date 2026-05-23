import type {
  InvoiceAiAnalysisResult,
  InvoiceAiEmissionLine,
  InvoiceAiTotalAmount,
  InvoiceEmissionCalculations
} from '../../../use-cases/invoice/types/invoice-ai-analysis.types.js';
import type {
  InvoiceGoldenRecord,
  InvoiceGoldenRecordExtractedData,
  InvoiceGoldenRecordMetadata
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
  readonly originalMetadata?: InvoiceGoldenRecordMetadata | Record<string, unknown>;
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

  const taxAmount = isTotalAmountObject(source.total_amount)
    ? numberOrZero(source.total_amount.tax_amount)
    : numberOrZero(source.tax_amount);

  const netAmount = isTotalAmountObject(source.total_amount)
    ? numberOrZero(source.total_amount.net_amount)
    : numberOrZero(source.net_amount);

  const emissionLines = input.aiAnalysis.emission_lines ?? [];
  const totalConsumption = sumKwhConsumption(emissionLines);
  const mainUnit = findMainKwhUnit(emissionLines);
  const unitPrice = totalConsumption > 0 ? totalAmount / totalConsumption : 0;

  const extractedData: InvoiceGoldenRecordExtractedData = {
    invoice_number: source.invoice_number ?? null,
    invoice_date: source.invoice_date ?? null,
    vendor: source.vendor?.name ?? 'Unknown',
    customer: (source.customer ?? {}) as Record<string, unknown>,
    cups: technical.cups ?? null,
    contract_reference: technical.contract_reference ?? null,
    contracted_power: {
      p1: technical.contracted_power_p1 ?? null,
      p2: technical.contracted_power_p2 ?? null
    },
    tariff: technical.tariff ?? null,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    net_amount: netAmount,
    currency: source.currency ?? 'EUR',
    billing_period: {
      start: billing.start ?? null,
      end: billing.end ?? null
    },
    lines: emissionLines
  };

  const climatiqResult: InvoiceGoldenRecord['climatiq_result'] =
    input.emissions && Object.keys(input.emissions).length > 0
      ? {
          co2e: numberOrZero(input.emissions.co2e ?? input.emissions.total_kg),
          co2e_unit: input.emissions.co2e_unit ?? 'kg',
          activity_id: input.emissions.activity_id ?? 'unknown',
          timestamp: now
        }
      : {};

  const cleanMetadata = (input.originalMetadata ?? {}) as Record<string, unknown>;
  const metadata: InvoiceGoldenRecordMetadata = {
    ...cleanMetadata,
    s3_key: typeof cleanMetadata.s3_key === 'string' ? cleanMetadata.s3_key : null,
    is_draft: false
  };

  return {
    PK: cleanPK,
    SK: input.sk,
    status: input.status || 'READY_FOR_REVIEW',
    processed_at: now,
    updated_at: now,
    analytics: {
      confidence_score: numberOrZero(input.aiAnalysis.confidence_score) || DEFAULT_CONFIDENCE,
      anomaly_detected: unitPrice > ANOMALY_UNIT_PRICE_THRESHOLD
    },
    ai_analysis: {
      service_type: input.category || 'ELECTRICITY',
      value: totalConsumption,
      unit: mainUnit,
      status_triage: 'DONE'
    },
    climatiq_result: climatiqResult,
    extracted_data: extractedData,
    metadata
  };
}
