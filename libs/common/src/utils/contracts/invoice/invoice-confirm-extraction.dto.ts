/**
 * Input plano del frontend cuando el humano confirma la extracción.
 *
 * Se envía vía mutation `confirmInvoiceExtraction(input: ConfirmExtractionInput!)`.
 * La api_lambda:
 *  1. Hace Zod parse de este shape (rechaza payloads malformados).
 *  2. Valida la transición `META.status ∈ {HUMAN_VALIDATED, HUMAN_CORRECTED}`
 *     contra `expectedVersion` (optimistic locking).
 *  3. Construye el `InvoiceGoldenRecord` definitivo.
 *  4. Persiste con `TransactWriteItems`:
 *       - Update META: status=PERSISTED, version++.
 *       - Put   GOLDEN: shape final (ConditionExpression: attribute_not_exists(SK)).
 *       - Put   AUDIT#<ts>: snapshot con `corrections[]`.
 *
 * Si `corrections[]` está vacío → semánticamente fue `HUMAN_VALIDATED`.
 * Si no → fue `HUMAN_CORRECTED` y el audit entry guarda el delta.
 */
import { z } from 'zod';
import { EnergyServiceTypeSchema } from '../shared/graphql-setup-enums.js';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';

/** Granularidad del cambio aplicado por el usuario sobre la sugerencia IA. */
export const InvoiceFieldCorrectionSchema = z.object({
  field: z.string().min(1),
  /** Valor IA original (puede ser null si la IA no extrajo nada). */
  oldValue: z.union([z.string(), z.number(), z.null()]),
  /** Valor que el usuario finalmente envió. */
  newValue: z.union([z.string(), z.number(), z.null()]),
  /** Razón opcional — útil cuando hay corrección masiva. */
  reason: z.string().max(512).optional(),
  /** Confidence original de la IA (para tracking de en qué se equivocó). */
  originalConfidence: z.number().min(0).max(1).optional()
});
export type InvoiceFieldCorrection = z.infer<typeof InvoiceFieldCorrectionSchema>;

/** Input core: lo que el usuario confirma. */
export const ConfirmInvoiceExtractionInputSchema = z
  .object({
    invoiceId: SmsIdSchema,

    /** Optimistic locking. La UI lee `version` del item META al cargar el draft. */
    expectedVersion: z.number().int().nonnegative(),

    /** Versión del draft de extracción usado como base (`INV#..#EXTRACTION#v<n>`). */
    extractionDraftVersion: z.number().int().min(1),

    // ── Datos confirmados (post-edición humana) ────────────────────────────
    vendor: z.string().min(1).max(160),
    vendorTaxId: z.string().min(1).max(40),

    invoiceNumber: z.string().min(1).max(64),
    invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invoiceDate must be ISO YYYY-MM-DD'),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be ISO YYYY-MM-DD')
      .optional(),

    billingPeriodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'billingPeriodStart must be ISO YYYY-MM-DD'),
    billingPeriodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'billingPeriodEnd must be ISO YYYY-MM-DD'),

    currency: z.string().length(3),
    totalAmount: z.number().finite().nonnegative(),
    taxAmount: z.number().finite().nonnegative().optional(),
    subtotalAmount: z.number().finite().nonnegative().optional(),

    consumptionValue: z.number().finite().nonnegative(),
    consumptionUnit: z.string().min(1).max(16),
    meterId: SmsIdSchema.optional(),
    energyType: EnergyServiceTypeSchema,

    // ── Clasificación operativa ────────────────────────────────────────────
    branchId: SmsIdSchema,
    buildingId: SmsIdSchema,
    costCenterId: SmsIdSchema.optional(),
    assetId: SmsIdSchema.optional(),

    // ── Auditoría/trazabilidad ─────────────────────────────────────────────
    corrections: z.array(InvoiceFieldCorrectionSchema).default([]),
    /** Notas internas del usuario (no van al Golden Record). */
    notes: z.string().max(2048).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Date(v.billingPeriodStart) > new Date(v.billingPeriodEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['billingPeriodEnd'],
        message: 'billingPeriodEnd must be >= billingPeriodStart'
      });
    }
    if (
      v.taxAmount !== undefined &&
      v.subtotalAmount !== undefined &&
      Math.abs(v.taxAmount + v.subtotalAmount - v.totalAmount) > 0.01
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalAmount'],
        message: 'subtotalAmount + taxAmount must equal totalAmount (±0.01)'
      });
    }
  });

export type ConfirmInvoiceExtractionInput = z.infer<typeof ConfirmInvoiceExtractionInputSchema>;

export const parseConfirmInvoiceExtractionInput = (
  input: unknown
): ConfirmInvoiceExtractionInput => ConfirmInvoiceExtractionInputSchema.parse(input);

export const safeParseConfirmInvoiceExtractionInput = (input: unknown) =>
  ConfirmInvoiceExtractionInputSchema.safeParse(input);

// ── Inputs para los otros use cases ──────────────────────────────────────────

export const CreateInvoiceDraftInputSchema = z
  .object({
    fileName: z.string().min(1).max(256),
    fileSize: z.number().int().positive().max(50 * 1024 * 1024),
    mimeType: z.string().min(1).max(128),
    /** Hint opcional: si el usuario ya seleccionó branch/building antes de subir. */
    branchId: SmsIdSchema.optional(),
    buildingId: SmsIdSchema.optional(),
    /** Hash SHA-256 calculado client-side para dedup. */
    documentHashSha256: z.string().length(64).optional()
  })
  .strict();
export type CreateInvoiceDraftInput = z.infer<typeof CreateInvoiceDraftInputSchema>;

export const RejectInvoiceInputSchema = z
  .object({
    invoiceId: SmsIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().min(3).max(512)
  })
  .strict();
export type RejectInvoiceInput = z.infer<typeof RejectInvoiceInputSchema>;

export const RetryInvoiceProcessingInputSchema = z
  .object({
    invoiceId: SmsIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    /** Causa documentada (opcional) — útil para distinguir retries automáticos vs manuales. */
    reason: z.string().max(512).optional()
  })
  .strict();
export type RetryInvoiceProcessingInput = z.infer<typeof RetryInvoiceProcessingInputSchema>;
