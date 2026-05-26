export * from './exceptions/application-validation.error.js';
export * from './ports/index.js';
export type {
  IInvoiceLifecycleRepository,
  InvoiceLifecycleIdentity,
  CreateInvoiceLifecycleInput,
  InvoiceStateTransitionInput,
  PersistExtractionDraftInput,
  PersistGoldenRecordInput,
  CommitInvoiceLifecycleStoreInput,
  InvoiceLifecycleWriteResult,
  InvoiceLifecycleSnapshot
} from './ports/invoice-lifecycle-repository.port.js';

// ============================================================================
// USE CASES
// ============================================================================

// dispatch-invoice-from-s3-put
export * from './use-cases/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.use-case.js';

// record-invoice-ia-extraction
export * from './use-cases/record-invoice-ia-extraction/record-invoice-ia-extraction.use-case.js';

// invoice (errors + types compartidos del bounded context)
export * from './use-cases/invoice/errors/InvoiceAlreadyExistsError.js';
export * from './use-cases/invoice/errors/InvoiceNotFoundError.js';
export * from './use-cases/invoice/errors/InvoiceNotProcessableError.js';
export * from './use-cases/invoice/errors/InvoiceVersionConflictError.js';
export * from './use-cases/invoice/errors/InvoiceInvalidStateTransitionError.js';
export * from './use-cases/invoice/types/index.js';

// invoice/<flow>
export * from './use-cases/invoice/register-invoice-intent/register-invoice-intent.use-case.js';
export * from './use-cases/invoice/process-invoice/process-invoice.use-case.js';
export * from './use-cases/invoice/process-invoice-pipeline/process-invoice-pipeline.use-case.js';
export * from './use-cases/invoice/process-invoice-queue-batch/process-invoice-queue-batch.use-case.js';
export * from './use-cases/invoice/create-presigned-upload-url/create-presigned-upload-url.use-case.js';
export * from './use-cases/invoice/enqueue-invoice-processing/enqueue-invoice-processing.use-case.js';

// invoice/<lifecycle v2 — drafts + golden record + audit append-only>
export * from './use-cases/invoice/create-invoice-draft/create-invoice-draft.use-case.js';
export * from './use-cases/invoice/confirm-invoice-extraction/confirm-invoice-extraction.use-case.js';
export * from './use-cases/invoice/commit-invoice-lifecycle/commit-invoice-lifecycle.use-case.js';
export * from './use-cases/invoice/reject-invoice/reject-invoice.use-case.js';
export * from './use-cases/invoice/retry-invoice-processing/retry-invoice-processing.use-case.js';
export * from './use-cases/invoice/handle-invoice-appsync-request/handle-invoice-appsync-request.use-case.js';

// events
export * from './use-cases/events/publish-domain-event/publish-domain-event.use-case.js';

// node-config (types compartidos + use case)
export type {
  PartitionContext,
  NodeConfigItem,
  SaveNodeInput,
  UpdateNodePayload,
  ListNodesFilter,
  SaveOrganizationRootInput,
  OperationFailure,
  SaveNodeSuccess,
  SaveOrganizationRootSuccess,
  UpdateNodeSuccess,
  DeleteNodeSuccess,
  SaveNodeResult,
  SaveOrganizationRootResult,
  UpdateNodeResult,
  DeleteNodeResult,
  GraphQLNode,
  MutationResponse
} from './use-cases/node-config/types/node-config.types.js';
export * from './use-cases/node-config/handle-appsync-request/handle-appsync-request.use-case.js';

// ============================================================================
// MAPPERS
// ============================================================================

export { DispatchInvoiceFromS3PutMapper } from './mappers/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.mapper.js';
export * from './mappers/invoice/register-invoice-intent/register-invoice-intent.mapper.js';
export * from './mappers/invoice/process-invoice-pipeline/process-invoice-pipeline.mapper.js';
export * from './mappers/invoice/process-invoice-queue-batch/process-invoice-queue-batch.mapper.js';
export * from './mappers/node-config/handle-appsync-request/handle-appsync-request.mapper.js';

// ============================================================================
// DTOs
// ============================================================================

// dispatch-invoice-from-s3-put
export type {
  S3DispatcherInvokeDto,
  DecodedInvoiceUploadKeyDto,
  DispatchInvoiceFromS3PutInputDto,
  DispatchInvoiceFromS3PutOutputDto,
  DispatcherEnqueueResultDto,
  InvoiceDispatchQueueMessageDto
} from './dtos/dispatch-invoice-from-s3-put/index.js';

// record-invoice-ia-extraction
export type { RecordInvoiceIaExtractionInputDto } from './dtos/record-invoice-ia-extraction/record-invoice-ia-extraction.input.dto.js';

// invoice/<flow>
export type { RegisterInvoiceIntentDto } from './dtos/invoice/register-invoice-intent/register-invoice-intent.dto.js';
export type { ProcessInvoiceDto } from './dtos/invoice/process-invoice/process-invoice.dto.js';
export type {
  ProcessInvoicePipelineInputDto,
  ProcessInvoicePipelineOutputDto
} from './dtos/invoice/process-invoice-pipeline/process-invoice-pipeline.dto.js';
export type {
  SqsBatchRecord,
  ProcessInvoiceQueueBatchInputDto,
  ProcessInvoiceQueueBatchOutputDto,
  ProcessInvoiceQueueBatchFailureItem,
  ParsedQueueRecord
} from './dtos/invoice/process-invoice-queue-batch/process-invoice-queue-batch.dto.js';
export type {
  CreatePresignedUploadUrlInputDto,
  CreatePresignedUploadUrlOutputDto
} from './dtos/invoice/create-presigned-upload-url/create-presigned-upload-url.dto.js';
export type {
  EnqueueInvoiceProcessingInputDto,
  EnqueueInvoiceProcessingOutputDto
} from './dtos/invoice/enqueue-invoice-processing/enqueue-invoice-processing.dto.js';

// events
export type {
  PublishDomainEventInputDto,
  PublishDomainEventOutputDto
} from './dtos/events/publish-domain-event/publish-domain-event.dto.js';

// node-config
export type {
  AppSyncMethodName,
  HandleAppSyncRequestInputDto,
  HandleAppSyncRequestOutputDto
} from './dtos/node-config/handle-appsync-request/handle-appsync-request.dto.js';
