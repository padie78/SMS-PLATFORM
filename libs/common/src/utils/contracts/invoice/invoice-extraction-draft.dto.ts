/**
 * Draft de extracción IA, persistido como item INMUTABLE en DynamoDB:
 *
 *   PK = TENANT#<t>#ORG#<o>
 *   SK = INV#<id>#EXTRACTION#v<n>
 *
 * Es la fotografía de lo que la IA produjo (OCR + Bedrock). El humano lo
 * lee, lo corrige en frontend y emite `confirmInvoiceExtraction`, que crea
 * un item nuevo `INV#<id>#GOLDEN` SIN tocar este draft (auditabilidad ESG).
 *
 * Versión cada vez que el worker reprocesa (retry, modelo nuevo, etc.).
 */
import { z } from 'zod';
import {
  EnergyServiceTypeSchema,
  type EnergyServiceType
} from '../shared/graphql-setup-enums.js';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';
import { InvoiceSkSchema } from '../../validation/schemas/invoice-sk.schema.js';
import {
  InvoiceConfidenceFieldSchema,
  InvoiceConfidenceLevelSchema,
  InvoiceExtractionWarningSchema,
  InvoiceSuspiciousValueSchema,
  classifyConfidence,
  type InvoiceConfidenceField
} from './invoice-confidence.dto.js';

const PartySchema = z
  .object({
    name: InvoiceConfidenceFieldSchema,
    taxId: InvoiceConfidenceFieldSchema
  })
  .strict();
export type InvoiceExtractionParty = z.infer<typeof PartySchema>;

const BillingPeriodFieldSchema = z
  .object({
    start: InvoiceConfidenceFieldSchema,
    end: InvoiceConfidenceFieldSchema
  })
  .strict();

const ConsumptionFieldSchema = z
  .object({
    value: InvoiceConfidenceFieldSchema,
    unit: InvoiceConfidenceFieldSchema,
    meterId: InvoiceConfidenceFieldSchema,
    energyType: EnergyServiceTypeSchema
  })
  .strict();

const LocationFieldSchema = z
  .object({
    branchId: SmsIdSchema.optional().nullable(),
    buildingId: SmsIdSchema.optional().nullable(),
    address: InvoiceConfidenceFieldSchema
  })
  .strict();

/** Modelo IA + meta. Auditoría a nivel pipeline (no por field). */
const ExtractionModelMetaSchema = z
  .object({
    pipelineVersion: z.string().min(1),
    modelProvider: z.string().min(1),
    modelName: z.string().min(1),
    promptTemplateId: z.string().min(1),
    runId: z.string().min(1),
    /** Hash SHA-256 del PDF — clave de idempotencia/dedup. */
    documentHashSha256: z.string().length(64).optional()
  })
  .strict();

/** Métricas técnicas opcionales (latencia, tokens) — útiles para FinOps. */
const ExtractionMetricsSchema = z
  .object({
    totalLatencyMs: z.number().int().nonnegative().default(0),
    ocrLatencyMs: z.number().int().nonnegative().default(0),
    classifierLatencyMs: z.number().int().nonnegative().default(0),
    analyzerLatencyMs: z.number().int().nonnegative().default(0),
    inputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0)
  })
  .strict();

export const InvoiceExtractionDraftSchema = z
  .object({
    PK: z.string().min(1),
    SK: z.string().regex(/^INV#[^\s/]+#EXTRACTION#v\d+$/, {
      message: 'SK must be INV#<id>#EXTRACTION#v<n>'
    }),
    invoiceId: SmsIdSchema,
    invoiceMetaSk: InvoiceSkSchema,
    version: z.number().int().min(1),
    createdAt: z.string().min(1),

    /** Score global combinado (`mean(field.confidence)` weighted). */
    overallConfidence: z.number().min(0).max(1),
    confidenceLevel: InvoiceConfidenceLevelSchema,

    vendor: PartySchema,
    customer: PartySchema.optional(),

    invoiceNumber: InvoiceConfidenceFieldSchema,
    invoiceDate: InvoiceConfidenceFieldSchema,
    dueDate: InvoiceConfidenceFieldSchema.optional(),
    billingPeriod: BillingPeriodFieldSchema,
    currency: InvoiceConfidenceFieldSchema,

    totalAmount: InvoiceConfidenceFieldSchema,
    taxAmount: InvoiceConfidenceFieldSchema.optional(),
    subtotalAmount: InvoiceConfidenceFieldSchema.optional(),

    consumption: ConsumptionFieldSchema,
    location: LocationFieldSchema.optional(),

    warnings: z.array(InvoiceExtractionWarningSchema).default([]),
    missingFields: z.array(z.string().min(1)).default([]),
    suspiciousValues: z.array(InvoiceSuspiciousValueSchema).default([]),

    modelMeta: ExtractionModelMetaSchema,
    metrics: ExtractionMetricsSchema.default({
      totalLatencyMs: 0,
      ocrLatencyMs: 0,
      classifierLatencyMs: 0,
      analyzerLatencyMs: 0,
      inputTokens: 0,
      outputTokens: 0
    })
  })
  .strict()
  .refine((d) => d.confidenceLevel === classifyConfidence(d.overallConfidence), {
    message: 'confidenceLevel must match overallConfidence bucket'
  });

export type InvoiceExtractionDraft = z.infer<typeof InvoiceExtractionDraftSchema>;

/**
 * Calcula el score global como promedio ponderado de los campos críticos.
 * Pesos pensados para reflejar el impacto auditable:
 *  - total/consumo > vendor > período > resto.
 */
export function computeOverallConfidence(fields: {
  vendorName?: InvoiceConfidenceField | null;
  invoiceNumber?: InvoiceConfidenceField | null;
  invoiceDate?: InvoiceConfidenceField | null;
  totalAmount?: InvoiceConfidenceField | null;
  consumptionValue?: InvoiceConfidenceField | null;
}): number {
  const items: Array<{ w: number; c: number | null }> = [
    { w: 0.15, c: fields.vendorName?.confidence ?? null },
    { w: 0.1, c: fields.invoiceNumber?.confidence ?? null },
    { w: 0.15, c: fields.invoiceDate?.confidence ?? null },
    { w: 0.3, c: fields.totalAmount?.confidence ?? null },
    { w: 0.3, c: fields.consumptionValue?.confidence ?? null }
  ];
  let num = 0;
  let den = 0;
  for (const it of items) {
    if (it.c !== null) {
      num += it.w * it.c;
      den += it.w;
    }
  }
  if (den === 0) return 0;
  return num / den;
}

/** Tipos auxiliares reexportados para los use cases (evita imports cruzados). */
export type InvoiceExtractionEnergyType = EnergyServiceType;
