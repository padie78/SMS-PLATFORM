export {
  InvoiceDTOSchema,
  parseInvoiceDTO,
  safeParseInvoiceDTO,
  type InvoiceDTO
} from './invoice.dto';

export {
  InvoiceIaTechnicalExtractionSchema,
  InvoiceIaExtractionSqsBodySchema,
  parseInvoiceIaExtractionSqsBody,
  buildInitialInvoiceIaTechnicalExtraction,
  type InvoiceIaTechnicalExtraction,
  type InvoiceIaExtractionSqsBody
} from './invoice-ia-technical-extraction.dto';

export {
  InvoiceProcessingSkeletonSchema,
  buildInvoiceProcessingSkeleton,
  type InvoiceProcessingSkeleton,
  type BuildInvoiceProcessingSkeletonParams
} from './invoice-processing-skeleton.dto';

export {
  InvoiceAuditActorSchema,
  InvoiceAuditActionSchema,
  InvoiceAuditSourceSchema,
  InvoiceAuditEntrySchema,
  InvoiceAuditTrailSchema,
  buildInitialAuditEntry,
  type InvoiceAuditActor,
  type InvoiceAuditAction,
  type InvoiceAuditSource,
  type InvoiceAuditEntry,
  type InvoiceAuditTrail
} from './invoice-audit-trail.dto';

export {
  InvoiceLifecycleStatusSchema,
  InvoiceCalculationMethodSchema,
  InvoiceBillingPeriodSchema,
  InvoiceExtractedDataSchema,
  InvoiceThoughtProcessSchema,
  InvoiceAiAnalysisSchema,
  InvoiceAnalyticsDimensionsSchema,
  InvoiceClimatiqResultSchema,
  InvoiceMetadataSchema,
  InvoiceDdbItemSchema,
  InvoiceConfirmPayloadSchema,
  parseInvoiceDdbItem,
  safeParseInvoiceDdbItem,
  parseInvoiceConfirmPayload,
  safeParseInvoiceConfirmPayload,
  type InvoiceLifecycleStatus,
  type InvoiceCalculationMethod,
  type InvoiceBillingPeriod,
  type InvoiceExtractedData,
  type InvoiceThoughtProcess,
  type InvoiceAiAnalysis,
  type InvoiceAnalyticsDimensions,
  type InvoiceClimatiqResult,
  type InvoiceMetadata,
  type InvoiceDdbItem,
  type InvoiceConfirmPayload
} from './invoice-ddb-item.dto';

// ── State machine v2 (25 estados) — fuente única para flujos nuevos ──────────
export {
  InvoiceLifecycleStateSchema,
  INVOICE_LIFECYCLE_STATE_VALUES,
  TERMINAL_INVOICE_STATES,
  PUBLISHABLE_INVOICE_STATES,
  VALID_INVOICE_STATE_TRANSITIONS,
  ALLOWED_FROM_STATES_FOR,
  INVOICE_STATE_OWNER,
  isValidInvoiceStateTransition,
  type InvoiceLifecycleState
} from './invoice-lifecycle-state.dto';

// ── Confidence per-field para extracción IA ─────────────────────────────────
export {
  INVOICE_CONFIDENCE_THRESHOLDS,
  InvoiceConfidenceLevelSchema,
  InvoiceConfidenceFieldSchema,
  InvoiceExtractionWarningSchema,
  InvoiceSuspiciousValueSchema,
  classifyConfidence,
  buildConfidenceField,
  InvoiceBoundingBoxSchema,
  InvoiceFieldGeometrySchema,
  type InvoiceConfidenceLevel,
  type InvoiceConfidenceField,
  type InvoiceBoundingBox,
  type InvoiceFieldGeometry,
  type InvoiceExtractionWarning,
  type InvoiceSuspiciousValue
} from './invoice-confidence.dto';

export {
  INVOICE_LOOKUP_PK_PREFIX,
  InvoiceLookupRefItemSchema,
  buildInvoiceLookupPk,
  buildInvoiceLookupRefItem,
  type InvoiceLookupRefItem
} from './invoice-lookup-ref.dto';

// ── Extraction draft (item DDB INV#..#EXTRACTION#v<n>) ──────────────────────
export {
  InvoiceExtractionDraftSchema,
  computeOverallConfidence,
  type InvoiceExtractionDraft,
  type InvoiceExtractionParty,
  type InvoiceExtractionEnergyType
} from './invoice-extraction-draft.dto';

// ── Confirm extraction + correction inputs (mutations api_lambda) ───────────
export {
  ConfirmInvoiceExtractionInputSchema,
  CreateInvoiceDraftInputSchema,
  RejectInvoiceInputSchema,
  RetryInvoiceProcessingInputSchema,
  InvoiceFieldCorrectionSchema,
  parseConfirmInvoiceExtractionInput,
  safeParseConfirmInvoiceExtractionInput,
  type ConfirmInvoiceExtractionInput,
  type CreateInvoiceDraftInput,
  type RejectInvoiceInput,
  type RetryInvoiceProcessingInput,
  type InvoiceFieldCorrection
} from './invoice-confirm-extraction.dto';

// ── Lifecycle item META (INV#..#META) ────────────────────────────────────────
export {
  InvoiceIngestionChannelSchema,
  InvoiceItemPointersSchema,
  InvoiceMetaSnapshotSchema,
  InvoiceLifecycleItemSchema,
  DEFAULT_INVOICE_WIP_TTL_SECONDS,
  computeWipTtl,
  buildInvoicePartitionKey,
  buildInvoiceMetaSk,
  buildInvoiceExtractionSk,
  buildInvoiceGoldenSk,
  buildInvoiceAuditSk,
  buildLifecycleGsiAttributes,
  type InvoiceIngestionChannel,
  type InvoiceItemPointers,
  type InvoiceMetaSnapshot,
  type InvoiceLifecycleItem
} from './invoice-lifecycle-item.dto';

// ── Commit lifecycle (payload final del wizard) ─────────────────────────────
export {
  CommitInvoiceLifecycleInputSchema,
  parseCommitInvoiceLifecycleInput,
  safeParseCommitInvoiceLifecycleInput,
  type CommitInvoiceLifecycleInput
} from './invoice-commit-lifecycle.dto';

// ── Audit entries v2 (INV#..#AUDIT#<ts>) — append-only ──────────────────────
// NOTA: `InvoiceAuditActorSchema` v1 (enum) sigue exportado arriba. La v2 es
// un objeto rico con type+userId+pipelineRunId, así que se exporta con alias
// `InvoiceAuditActorV2Schema` para evitar colisión nominal en consumidores.
export {
  InvoiceAuditActorTypeSchema,
  InvoiceAuditEventSchema,
  InvoiceAuditActorSchema as InvoiceAuditActorV2Schema,
  InvoiceAuditEntryItemSchema,
  buildAuditEntryItem,
  type InvoiceAuditActorType,
  type InvoiceAuditEvent,
  type InvoiceAuditActor as InvoiceAuditActorV2,
  type InvoiceAuditEntryItem
} from './invoice-audit-entry.dto';
