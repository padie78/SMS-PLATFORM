/**
 * Audit entry append-only que persiste cada transición de estado, decisión
 * humana y delta de correcciones aplicadas.
 *
 *   PK = TENANT#<t>#ORG#<o>
 *   SK = INV#<id>#AUDIT#<isoTimestamp>
 *
 * Política:
 *  - NUNCA se actualiza una entry existente. Cada cambio = nuevo Put.
 *  - El operador (worker, api_lambda, etc.) es quien crea la entry.
 *  - Si la entry está relacionada con un cambio del usuario, se guarda
 *    `actor.userId` + `corrections[]`.
 *  - Para emisiones del worker, `actor` = SYSTEM_* con `pipelineRunId`.
 *
 * Este shape es independiente del legacy `invoice-audit-trail.dto.ts` (que
 * vivía como un array nested dentro del item). Se mueve a items separados
 * para escapar del 400KB limit de DynamoDB y permitir queries por rango.
 */
import { z } from 'zod';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';
import { InvoiceLifecycleStateSchema } from './invoice-lifecycle-state.dto.js';
import { InvoiceFieldCorrectionSchema } from './invoice-confirm-extraction.dto.js';

export const InvoiceAuditActorTypeSchema = z.enum([
  'SYSTEM_DISPATCHER',
  'SYSTEM_WORKER_OCR',
  'SYSTEM_WORKER_AI',
  'SYSTEM_WORKER_PIPELINE',
  'SYSTEM_API',
  'USER'
]);
export type InvoiceAuditActorType = z.infer<typeof InvoiceAuditActorTypeSchema>;

export const InvoiceAuditEventSchema = z.enum([
  'STATE_TRANSITION',
  'USER_CONFIRMED_NO_CHANGES',
  'USER_CORRECTED',
  'USER_REJECTED',
  'USER_RETRIED',
  'PIPELINE_FAILED',
  'PIPELINE_RECOVERED',
  'DLQ_REPLAY'
]);
export type InvoiceAuditEvent = z.infer<typeof InvoiceAuditEventSchema>;

export const InvoiceAuditActorSchema = z
  .object({
    type: InvoiceAuditActorTypeSchema,
    userId: SmsIdSchema.optional(),
    userEmail: z.string().email().optional(),
    pipelineRunId: z.string().optional(),
    correlationId: z.string().optional()
  })
  .strict();
export type InvoiceAuditActor = z.infer<typeof InvoiceAuditActorSchema>;

export const InvoiceAuditEntryItemSchema = z
  .object({
    PK: z.string().regex(/^TENANT#[^#]+#ORG#[^#]+$/),
    SK: z.string().regex(/^INV#[^\s/]+#AUDIT#[0-9TZ.:\-+]+$/),
    invoiceId: SmsIdSchema,

    /** ISO-8601 — duplicado en `SK` por sortability + en attr para queries. */
    timestamp: z.string().min(1),

    event: InvoiceAuditEventSchema,
    actor: InvoiceAuditActorSchema,

    fromStatus: InvoiceLifecycleStateSchema.optional(),
    toStatus: InvoiceLifecycleStateSchema,

    /** Versión del item META resultante (post-write). */
    resultingVersion: z.number().int().nonnegative(),

    /** Sólo presente en eventos `USER_CORRECTED`. */
    corrections: z.array(InvoiceFieldCorrectionSchema).optional(),

    /** Texto libre opcional (failureReason, notes, traceId, etc.). */
    details: z.string().max(2048).optional(),

    /** Metadata arbitraria adicional (snapshot del modelo, retry count, etc.). */
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type InvoiceAuditEntryItem = z.infer<typeof InvoiceAuditEntryItemSchema>;

/** Constructor por defecto para reducir boilerplate en use cases. */
export function buildAuditEntryItem(input: {
  pk: string;
  invoiceId: string;
  timestamp: string;
  event: InvoiceAuditEvent;
  actor: InvoiceAuditActor;
  fromStatus?: z.infer<typeof InvoiceLifecycleStateSchema>;
  toStatus: z.infer<typeof InvoiceLifecycleStateSchema>;
  resultingVersion: number;
  corrections?: z.infer<typeof InvoiceFieldCorrectionSchema>[];
  details?: string;
  metadata?: Record<string, unknown>;
}): InvoiceAuditEntryItem {
  return InvoiceAuditEntryItemSchema.parse({
    PK: input.pk,
    SK: `INV#${input.invoiceId}#AUDIT#${input.timestamp}`,
    invoiceId: input.invoiceId,
    timestamp: input.timestamp,
    event: input.event,
    actor: input.actor,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    resultingVersion: input.resultingVersion,
    corrections: input.corrections,
    details: input.details,
    metadata: input.metadata
  });
}
