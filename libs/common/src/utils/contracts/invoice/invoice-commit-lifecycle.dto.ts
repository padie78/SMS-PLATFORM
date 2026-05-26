/**
 * Payload ÚNICO que el wizard envía en el último step.
 *
 * Filosofía: el stepper acumula TODOS los datos del usuario en su WIP store
 * local (Angular signal + sessionStorage). Mientras avanza por los pasos,
 * NO se hace ninguna mutación a DDB con datos del usuario; los únicos items
 * que se persisten en backend durante el flujo son:
 *
 *   1. `INV#<id>#META` (`isWip=true`, TTL=24h) — creado por el dispatcher al
 *      recibir el evento S3 PUT. Necesario para que SQS+worker tengan un
 *      ancla en DDB.
 *   2. `INV#<id>#EXTRACTION#v<n>` (`isWip=true`, TTL=24h) — creado por el
 *      worker tras OCR+IA. El frontend lo lee para mostrar el draft.
 *
 * Ambos son temporales: si el usuario abandona el wizard, DynamoDB TTL los
 * borra automáticamente.
 *
 * Cuando el usuario aprieta "Confirmar" en el último step:
 *
 *   - `commitInvoiceLifecycle(input: CommitInvoiceLifecycleInput!)`
 *   - el use case ejecuta UNA `TransactWriteItems`:
 *       * UPDATE META: status=PERSISTED, isWip=false, REMOVE ttl,
 *         pointers.goldenRecordSk, version++.
 *       * PUT GOLDEN (ConditionExpression: attribute_not_exists(SK)).
 *       * PUT AUDIT entry con `corrections[]` y datos consolidados.
 *
 * Si el usuario edita SIN extracción IA previa (manual entry) el
 * `extractionDraftVersion` puede ser `null`.
 */
import { z } from 'zod';
import { EnergyServiceTypeSchema } from '../shared/graphql-setup-enums.js';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';
import { InvoiceFieldCorrectionSchema } from './invoice-confirm-extraction.dto.js';

export const CommitInvoiceLifecycleInputSchema = z
  .object({
    invoiceId: SmsIdSchema,

    /**
     * Versión esperada del item META (sin contar versiones internas que el
     * worker incrementó). Si no se conoce (FE recién montó el wizard) se
     * envía `null` y el repo aplica la transición desde cualquier estado
     * compatible.
     */
    expectedVersion: z.number().int().nonnegative().nullable(),

    /**
     * Versión del último draft de extracción IA que el FE leyó. Permite
     * detectar reprocesamientos del worker durante la sesión humana y forzar
     * un refresh antes de pisar el GOLDEN. `null` = no había draft IA.
     */
    extractionDraftVersion: z.number().int().min(1).nullable(),

    // ── Datos finales (post-edición humana) ────────────────────────────────
    vendor: z.string().min(1).max(160),
    vendorTaxId: z.string().min(1).max(40),

    invoiceNumber: z.string().min(1).max(64),
    invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

    billingPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    billingPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

    currency: z.string().length(3),
    totalAmount: z.number().finite().nonnegative(),
    taxAmount: z.number().finite().nonnegative().optional(),
    subtotalAmount: z.number().finite().nonnegative().optional(),

    consumptionValue: z.number().finite().nonnegative(),
    consumptionUnit: z.string().min(1).max(16),
    meterId: SmsIdSchema.optional(),
    energyType: EnergyServiceTypeSchema,

    branchId: SmsIdSchema,
    buildingId: SmsIdSchema,
    costCenterId: SmsIdSchema.optional(),
    assetId: SmsIdSchema.optional(),

    // ── Auditoría/trazabilidad ─────────────────────────────────────────────
    corrections: z.array(InvoiceFieldCorrectionSchema).default([]),
    notes: z.string().max(2048).optional(),

    /**
     * Hash SHA-256 del WIP snapshot que el FE consolidó. Útil para tracking
     * si dos pestañas del browser intentaron commitear simultáneamente.
     */
    wipSnapshotHash: z.string().length(64).optional(),

    /** Override opcional del scope organizacional (si Cognito no lo trae). */
    orgId: SmsIdSchema.optional()
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

export type CommitInvoiceLifecycleInput = z.infer<typeof CommitInvoiceLifecycleInputSchema>;

export const parseCommitInvoiceLifecycleInput = (
  input: unknown
): CommitInvoiceLifecycleInput => CommitInvoiceLifecycleInputSchema.parse(input);

export const safeParseCommitInvoiceLifecycleInput = (input: unknown) =>
  CommitInvoiceLifecycleInputSchema.safeParse(input);
