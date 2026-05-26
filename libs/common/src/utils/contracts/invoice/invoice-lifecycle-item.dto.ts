/**
 * Item DynamoDB que tracking-ea el ciclo de vida COMPLETO de una invoice.
 *
 *   PK = TENANT#<t>#ORG#<o>
 *   SK = INV#<id>#META
 *
 * Es el "puntero raíz" de la factura. Apunta a:
 *  - `INV#<id>#EXTRACTION#v<n>` — drafts IA inmutables (uno por reproceso).
 *  - `INV#<id>#GOLDEN`           — golden record final (post-confirmación humana).
 *  - `INV#<id>#AUDIT#<ts>`       — entries append-only.
 *
 * Optimistic locking: cada update incrementa `version`. La UI envía
 * `expectedVersion` en `confirmInvoiceExtraction` y el repo aplica
 * `ConditionExpression: version = :expectedVersion AND #status IN (:fromStates)`.
 */
import { z } from 'zod';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';
import { InvoiceSkSchema } from '../../validation/schemas/invoice-sk.schema.js';
import { InvoiceLifecycleStateSchema } from './invoice-lifecycle-state.dto.js';

/** Origen del registro (regla 8.x: `ingestion_source`). */
export const InvoiceIngestionChannelSchema = z.enum([
  'PORTAL',
  'EMAIL',
  'API',
  'FISCAL',
  'MOBILE'
]);
export type InvoiceIngestionChannel = z.infer<typeof InvoiceIngestionChannelSchema>;

/** Punteros a items hijos del lifecycle. */
export const InvoiceItemPointersSchema = z
  .object({
    latestExtractionDraftSk: z.string().regex(/^INV#[^\s/]+#EXTRACTION#v\d+$/).optional(),
    latestExtractionDraftVersion: z.number().int().nonnegative().optional(),
    goldenRecordSk: z.string().regex(/^INV#[^\s/]+#GOLDEN$/).optional()
  })
  .strict();
export type InvoiceItemPointers = z.infer<typeof InvoiceItemPointersSchema>;

/**
 * Resumen denormalizado para listados/cards en la UI sin tener que ir al
 * GOLDEN cada vez. Se rellena progresivamente a medida que avanzan las fases.
 */
export const InvoiceMetaSnapshotSchema = z
  .object({
    fileName: z.string().optional(),
    fileSize: z.number().int().nonnegative().optional(),
    mimeType: z.string().optional(),
    documentHashSha256: z.string().length(64).optional(),
    vendor: z.string().optional(),
    invoiceNumber: z.string().optional(),
    invoiceDate: z.string().optional(),
    totalAmount: z.number().finite().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    branchId: SmsIdSchema.optional(),
    buildingId: SmsIdSchema.optional(),
    confidenceScore: z.number().min(0).max(1).optional(),
    failureReason: z.string().optional(),
    retryCount: z.number().int().nonnegative().default(0)
  })
  .strict();
export type InvoiceMetaSnapshot = z.infer<typeof InvoiceMetaSnapshotSchema>;

export const InvoiceLifecycleItemSchema = z
  .object({
    PK: z.string().regex(/^TENANT#[^#]+#ORG#[^#]+$/, {
      message: 'PK must be TENANT#<t>#ORG#<o>'
    }),
    SK: InvoiceSkSchema.refine((sk) => sk.endsWith('#META') || /^INV#[^\s/]+$/.test(sk), {
      message: 'SK should be INV#<id>#META (canonical) or INV#<id> (legacy)'
    }),
    invoiceId: SmsIdSchema,
    tenantId: z.string().min(1),
    orgId: z.string().min(1),

    status: InvoiceLifecycleStateSchema,
    version: z.number().int().nonnegative(),

    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),

    s3Bucket: z.string().optional(),
    s3Key: z.string().optional(),
    ingestionChannel: InvoiceIngestionChannelSchema.optional(),

    pointers: InvoiceItemPointersSchema.default({}),
    snapshot: InvoiceMetaSnapshotSchema.default({ retryCount: 0 }),

    // ── WIP semantics: el frontend mantiene los datos en sessionStorage y solo
    // hace `commitInvoiceLifecycle` en el último step. Mientras tanto, el
    // dispatcher / worker SÍ persisten items necesarios para que la IA pueda
    // correr (S3 → DDB skeleton → SQS → worker → EXTRACTION). Esos items
    // se marcan con `isWip=true` y un `ttl` (epoch seconds) que DynamoDB
    // limpia automáticamente si el usuario abandona el wizard (default: 24h).
    isWip: z.boolean().default(true),
    /** Epoch seconds (no millis) — formato que DynamoDB TTL espera. */
    ttl: z.number().int().positive().optional(),
    wipExpiresAt: z.string().optional(),

    // ── Atributos GSI denormalizados ────────────────────────────────────────
    GSI_Status_PK: z.string().optional(),
    GSI_Status_SK: z.string().optional(),
    GSI_Branch_PK: z.string().optional(),
    GSI_Branch_SK: z.string().optional()
  })
  .strict();
export type InvoiceLifecycleItem = z.infer<typeof InvoiceLifecycleItemSchema>;

/** Helper para PK estándar multi-tenant. */
export function buildInvoicePartitionKey(tenantId: string, orgId: string): string {
  return `TENANT#${tenantId.trim()}#ORG#${orgId.trim()}`;
}

/** SK canónico para el item META. */
export function buildInvoiceMetaSk(invoiceId: string): string {
  return `INV#${invoiceId.trim()}#META`;
}

/** SK para drafts IA versionados. */
export function buildInvoiceExtractionSk(invoiceId: string, version: number): string {
  if (version < 1 || !Number.isInteger(version)) {
    throw new Error(`buildInvoiceExtractionSk: version must be positive integer, got ${version}`);
  }
  return `INV#${invoiceId.trim()}#EXTRACTION#v${version}`;
}

/** SK para golden record. */
export function buildInvoiceGoldenSk(invoiceId: string): string {
  return `INV#${invoiceId.trim()}#GOLDEN`;
}

/** SK para entries de auditoría append-only. */
export function buildInvoiceAuditSk(invoiceId: string, isoTimestamp: string): string {
  return `INV#${invoiceId.trim()}#AUDIT#${isoTimestamp}`;
}

/** TTL por defecto para items WIP (24h = 86400s). */
export const DEFAULT_INVOICE_WIP_TTL_SECONDS = 24 * 60 * 60;

/** Calcula epoch seconds para `now + windowSeconds`. */
export function computeWipTtl(nowMs: number, windowSeconds = DEFAULT_INVOICE_WIP_TTL_SECONDS): {
  ttl: number;
  expiresAtIso: string;
} {
  const ttl = Math.floor(nowMs / 1000) + windowSeconds;
  const expiresAtIso = new Date(ttl * 1000).toISOString();
  return { ttl, expiresAtIso };
}

/** Valores denormalizados para los GSIs declarados en `terraform/modules/database`. */
export function buildLifecycleGsiAttributes(input: {
  tenantId: string;
  orgId: string;
  status: string;
  updatedAt: string;
  branchId?: string;
  invoiceDate?: string;
  invoiceId: string;
}): Pick<InvoiceLifecycleItem, 'GSI_Status_PK' | 'GSI_Status_SK' | 'GSI_Branch_PK' | 'GSI_Branch_SK'> {
  const out: Pick<
    InvoiceLifecycleItem,
    'GSI_Status_PK' | 'GSI_Status_SK' | 'GSI_Branch_PK' | 'GSI_Branch_SK'
  > = {
    GSI_Status_PK: `TENANT#${input.tenantId}#ORG#${input.orgId}#STATUS#${input.status}`,
    GSI_Status_SK: input.updatedAt
  };
  if (input.branchId && input.invoiceDate) {
    out.GSI_Branch_PK = `TENANT#${input.tenantId}#ORG#${input.orgId}#BRANCH#${input.branchId}`;
    out.GSI_Branch_SK = `${input.invoiceDate}#INV#${input.invoiceId}`;
  }
  return out;
}
