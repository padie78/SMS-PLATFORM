/**
 * Driven port: persistencia transaccional del lifecycle de una invoice.
 *
 * Responsabilidades:
 *  - Crear el item META (`INV#<id>#META`) con `version = 0`.
 *  - Aplicar transiciones de estado con `ConditionExpression` que valida
 *    `version == :expectedVersion AND #status IN (:allowedFromStates)`.
 *  - Persistir transaccionalmente META + EXTRACTION + AUDIT (o META + GOLDEN
 *    + AUDIT) en una sola operación `TransactWriteItems`.
 *  - Leer el snapshot completo (META + último EXTRACTION + GOLDEN si existe).
 *
 * El adaptador (DynamoDB) implementa las condition expressions y traduce
 * `TransactionCanceledException` → `InvoiceVersionConflictError`.
 */
import type {
  InvoiceAuditEntryItem,
  InvoiceExtractionDraft,
  InvoiceLifecycleItem,
  InvoiceLifecycleState,
  InvoiceLookupRefItem
} from '@sms/common';
import type { InvoiceGoldenRecord } from '../use-cases/invoice/types/invoice-golden-record.types.js';

/** Identificador compuesto del invoice multi-tenant. */
export interface InvoiceLifecycleIdentity {
  readonly tenantId: string;
  readonly orgId: string;
  readonly invoiceId: string;
}

/** Input para crear el item META inicial. */
export interface CreateInvoiceLifecycleInput extends InvoiceLifecycleIdentity {
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly initialStatus: InvoiceLifecycleState; // 'DRAFT' | 'UPLOADED' (S3 PUT)
  readonly s3Bucket?: string;
  readonly s3Key?: string;
  readonly ingestionChannel?: 'PORTAL' | 'EMAIL' | 'API' | 'FISCAL' | 'MOBILE';
  readonly branchId?: string;
  readonly buildingId?: string;
  readonly documentHashSha256?: string;
  /**
   * Si `true` (default), el item META se persiste con `isWip=true` + `ttl`
   * (24h por defecto). Si el usuario nunca llega al commit, DynamoDB TTL
   * limpia el item automáticamente.
   */
  readonly markAsWip?: boolean;
  /** Override del TTL window (segundos). Default = 24h. */
  readonly wipTtlSeconds?: number;
  /** Append audit entry inicial. */
  readonly initialAudit: InvoiceAuditEntryItem;
}

/** Input genérico para una transición de estado simple (sin escribir items hijos). */
export interface InvoiceStateTransitionInput extends InvoiceLifecycleIdentity {
  readonly expectedVersion: number;
  readonly allowedFromStates: ReadonlyArray<InvoiceLifecycleState>;
  readonly toState: InvoiceLifecycleState;
  readonly auditEntry: InvoiceAuditEntryItem;
  /** Opcional: parche al snapshot denormalizado (failureReason, retryCount++). */
  readonly snapshotPatch?: Record<string, unknown>;
}

/** Persistencia transaccional del draft de extracción (worker → DDB). */
export interface PersistExtractionDraftInput extends InvoiceLifecycleIdentity {
  readonly expectedVersion: number;
  readonly allowedFromStates: ReadonlyArray<InvoiceLifecycleState>;
  readonly toState: InvoiceLifecycleState; // típicamente 'AI_VALIDATION_REQUIRED'
  readonly extractionDraft: InvoiceExtractionDraft;
  readonly auditEntry: InvoiceAuditEntryItem;
  readonly snapshotPatch?: Record<string, unknown>;
}

/** Confirmación final por humano: persistir GOLDEN + actualizar META + AUDIT. */
export interface PersistGoldenRecordInput extends InvoiceLifecycleIdentity {
  readonly expectedVersion: number;
  readonly allowedFromStates: ReadonlyArray<InvoiceLifecycleState>;
  readonly toState: InvoiceLifecycleState; // 'PERSISTED' o 'COMPLETED'
  readonly goldenRecord: InvoiceGoldenRecord;
  readonly auditEntry: InvoiceAuditEntryItem;
  readonly snapshotPatch?: Record<string, unknown>;
}

/**
 * Commit del wizard (último step). Idéntico a `PersistGoldenRecordInput` en
 * inputs pero con dos diferencias:
 *
 *  - `expectedVersion` puede ser `null` cuando el FE no la conoce (recién
 *    montó el wizard); el repo aplica la transición permitiendo cualquier
 *    `version >= 0` y validando solo el `status`.
 *  - REMOVE `ttl` + SET `isWip = false` en el item META para promover los
 *    items WIP a permanentes (DynamoDB TTL ya no los limpiará).
 */
export interface CommitInvoiceLifecycleStoreInput extends InvoiceLifecycleIdentity {
  readonly expectedVersion: number | null;
  readonly allowedFromStates: ReadonlyArray<InvoiceLifecycleState>;
  readonly toState: InvoiceLifecycleState; // 'PERSISTED'
  readonly goldenRecord: InvoiceGoldenRecord;
  readonly auditEntry: InvoiceAuditEntryItem;
  readonly snapshotPatch?: Record<string, unknown>;
}

/** Resultado común: nueva versión del META post-write. */
export interface InvoiceLifecycleWriteResult {
  readonly invoiceId: string;
  readonly newVersion: number;
  readonly newState: InvoiceLifecycleState;
  readonly updatedAt: string;
}

/** Snapshot completo para lecturas (UI). */
export interface InvoiceLifecycleSnapshot {
  readonly meta: InvoiceLifecycleItem;
  readonly latestExtractionDraft: InvoiceExtractionDraft | null;
  readonly goldenRecord: InvoiceGoldenRecord | null;
}

/** Resultado de lookup por hash de documento (idempotencia createInvoiceDraft). */
export interface InvoiceDocumentHashLookupResult {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly version: number;
  readonly status: InvoiceLifecycleState;
}

export interface IInvoiceLifecycleRepository {
  /** Crea el item META + audit inicial (idempotente vía `attribute_not_exists(SK)`). */
  createLifecycle(input: CreateInvoiceLifecycleInput): Promise<InvoiceLifecycleWriteResult>;

  /** Resuelve tenant/org desde item LOOKUP#INV#<id> (dispatcher S3). */
  getInvoiceLookupRef(invoiceId: string): Promise<InvoiceLookupRefItem | null>;

  /** Idempotencia: busca invoice activa WIP con el mismo SHA-256. */
  findActiveByDocumentHash(
    documentHashSha256: string
  ): Promise<InvoiceDocumentHashLookupResult | null>;

  /** Lee el snapshot (META + último draft + golden). Retorna `null` si no existe. */
  getLifecycleSnapshot(identity: InvoiceLifecycleIdentity): Promise<InvoiceLifecycleSnapshot | null>;

  /** Transición de estado sin items hijos (ej. DRAFT→UPLOADING, UPLOADED→DISPATCHED). */
  transitionState(input: InvoiceStateTransitionInput): Promise<InvoiceLifecycleWriteResult>;

  /** Worker persiste draft IA + transiciona estado (TransactWrite atómico). */
  persistExtractionDraft(input: PersistExtractionDraftInput): Promise<InvoiceLifecycleWriteResult>;

  /** Humano confirma → persiste GOLDEN + transiciona estado + audit (TransactWrite). */
  persistGoldenRecord(input: PersistGoldenRecordInput): Promise<InvoiceLifecycleWriteResult>;

  /**
   * Commit final del wizard: promueve items WIP → permanentes en una sola
   * `TransactWriteItems`. Diferencias vs `persistGoldenRecord`:
   *   - REMOVE atributo `ttl` del META (DDB TTL ya no lo limpiará).
   *   - SET `isWip = false`.
   *   - `expectedVersion: null` ⇒ skip version check (solo valida status).
   */
  commitLifecycle(input: CommitInvoiceLifecycleStoreInput): Promise<InvoiceLifecycleWriteResult>;
}
