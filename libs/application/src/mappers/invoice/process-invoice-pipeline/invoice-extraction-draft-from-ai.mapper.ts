import {
  buildConfidenceField,
  buildInvoiceExtractionSk,
  buildInvoiceMetaSk,
  buildInvoicePartitionKey,
  classifyConfidence,
  computeOverallConfidence,
  type InvoiceExtractionDraft,
  type InvoiceExtractionWarning,
  type InvoiceSuspiciousValue
} from '@sms/common';

import type { InvoiceAiAnalysisResult } from '../../../use-cases/invoice/types/invoice-ai-analysis.types.js';

const DEFAULT_CONFIDENCE = 0.75;

const scoreFrom = (explicit?: number): number => {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(1, explicit));
  }
  return DEFAULT_CONFIDENCE;
};

const field = (value: string | null, confidence?: number, rawOcr?: string | null) =>
  buildConfidenceField({
    value,
    confidence: scoreFrom(confidence),
    rawOcr: rawOcr ?? value
  });

const numField = (value: number | null | undefined, confidence?: number) =>
  buildConfidenceField({
    value: value != null ? String(value) : null,
    numericValue: value ?? null,
    confidence: scoreFrom(confidence)
  });

export function buildExtractionDraftFromAiAnalysis(input: {
  tenantId: string;
  orgId: string;
  invoiceId: string;
  version: number;
  category: string;
  aiAnalysis: InvoiceAiAnalysisResult;
  pipelineRunId: string;
  metrics?: {
    totalLatencyMs?: number;
    ocrLatencyMs?: number;
    classifierLatencyMs?: number;
    analyzerLatencyMs?: number;
  };
}): InvoiceExtractionDraft {
  const now = new Date().toISOString();
  const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
  const sk = buildInvoiceExtractionSk(input.invoiceId, input.version);
  const source = input.aiAnalysis.source_data ?? {};
  const tech = input.aiAnalysis.technical_ids ?? {};
  const overall = scoreFrom(input.aiAnalysis.confidence_score);

  const totalAmountField = source.total_amount;
  const totalWithTax =
    typeof totalAmountField === 'object' && totalAmountField !== null
      ? totalAmountField.total_with_tax
      : typeof totalAmountField === 'number'
        ? totalAmountField
        : null;

  const warnings: InvoiceExtractionWarning[] = [];
  const suspiciousValues: InvoiceSuspiciousValue[] = [];

  if (overall < 0.7) {
    warnings.push({
      code: 'LOW_OVERALL_CONFIDENCE',
      field: '_overall',
      message: 'La confianza global de la extracción es baja; revisar todos los campos.'
    });
  }
  if (totalWithTax === 0 || totalWithTax == null) {
    suspiciousValues.push({
      field: 'totalAmount',
      value: String(totalWithTax ?? ''),
      reason: 'Importe total ausente o cero',
      severity: 'WARN'
    });
  }

  const vendorName = field(source.vendor?.name ?? null, overall);
  const vendorTaxId = field(source.vendor?.tax_id ?? null, overall);
  const invoiceNumber = field(source.invoice_number ?? null, overall);
  const invoiceDate = field(source.invoice_date ?? source.date ?? null, overall);
  const totalAmount = numField(totalWithTax, overall);
  const consumptionValue = numField(
    input.aiAnalysis.emission_lines?.[0]?.value ?? null,
    input.aiAnalysis.emission_lines?.[0]?.confidence_score
  );
  const overallConfidence = computeOverallConfidence({
    vendorName,
    invoiceNumber,
    invoiceDate,
    totalAmount,
    consumptionValue
  });

  const draft: InvoiceExtractionDraft = {
    PK: pk,
    SK: sk,
    invoiceId: input.invoiceId,
    invoiceMetaSk: buildInvoiceMetaSk(input.invoiceId),
    version: input.version,
    createdAt: now,
    vendor: {
      name: vendorName,
      taxId: vendorTaxId
    },
    customer: source.customer
      ? {
          name: field(source.customer.name ?? null, overall),
          taxId: field(source.customer.tax_id ?? null, overall)
        }
      : undefined,
    invoiceNumber,
    invoiceDate,
    dueDate: field(null, 0.5),
    billingPeriod: {
      start: field(source.billing_period?.start ?? null, overall),
      end: field(source.billing_period?.end ?? null, overall)
    },
    currency: field(source.currency ?? 'EUR', overall),
    totalAmount,
    taxAmount: numField(
      typeof totalAmountField === 'object' ? totalAmountField?.tax_amount : source.tax_amount,
      overall
    ),
    subtotalAmount: numField(
      typeof totalAmountField === 'object' ? totalAmountField?.net_amount : source.net_amount,
      overall
    ),
    consumption: {
      value: consumptionValue,
      unit: field(input.aiAnalysis.emission_lines?.[0]?.unit ?? 'kWh', overall),
      meterId: field(tech.meter_id ?? null, overall),
      energyType: (input.category?.toUpperCase().includes('GAS')
        ? 'GAS'
        : input.category?.toUpperCase().includes('WATER')
          ? 'WATER'
          : 'ELECTRICITY') as InvoiceExtractionDraft['consumption']['energyType']
    },
    location: {
      branchId: null,
      buildingId: null,
      address: field(source.customer?.address ?? null, 0.5)
    },
    overallConfidence,
    confidenceLevel: classifyConfidence(overallConfidence),
    warnings,
    missingFields: [],
    suspiciousValues,
    modelMeta: {
      pipelineVersion: '2.0.0',
      modelProvider: 'aws-bedrock',
      modelName: process.env['BEDROCK_MODEL_ID'] ?? 'anthropic.claude',
      promptTemplateId: 'invoice-extraction-v2',
      runId: input.pipelineRunId
    },
    metrics: {
      totalLatencyMs: input.metrics?.totalLatencyMs ?? 0,
      ocrLatencyMs: input.metrics?.ocrLatencyMs ?? 0,
      classifierLatencyMs: input.metrics?.classifierLatencyMs ?? 0,
      analyzerLatencyMs: input.metrics?.analyzerLatencyMs ?? 0,
      inputTokens: 0,
      outputTokens: 0
    }
  };

  return draft;
}
