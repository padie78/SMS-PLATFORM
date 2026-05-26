/**
 * Router AppSync para todas las operaciones del bounded context Invoice.
 *
 * El handler de infraestructura (`createAppSyncInvoiceHandler`) normaliza el
 * evento (claims, args, fieldName) y delega aquí. Esta clase NO toca AWS:
 * solo orquesta use cases por `fieldName`.
 *
 * fieldNames soportados:
 *  - Mutation.createInvoiceDraft
 *  - Mutation.confirmInvoiceExtraction
 *  - Mutation.rejectInvoice
 *  - Mutation.retryInvoiceProcessing
 *  - Query.getInvoiceLifecycle
 *  - Query.listInvoicesByStatus    (TODO — pendiente repo.listByStatus)
 */
import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type {
  CommitInvoiceLifecycleInput,
  ConfirmInvoiceExtractionInput,
  CreateInvoiceDraftInput,
  InvoiceLifecycleState,
  RejectInvoiceInput,
  RetryInvoiceProcessingInput
} from '@sms/common';

import type { CreateInvoiceDraftUseCase } from '../create-invoice-draft/create-invoice-draft.use-case.js';
import type { ConfirmInvoiceExtractionUseCase } from '../confirm-invoice-extraction/confirm-invoice-extraction.use-case.js';
import type { CommitInvoiceLifecycleUseCase } from '../commit-invoice-lifecycle/commit-invoice-lifecycle.use-case.js';
import type { RejectInvoiceUseCase } from '../reject-invoice/reject-invoice.use-case.js';
import type { RetryInvoiceProcessingUseCase } from '../retry-invoice-processing/retry-invoice-processing.use-case.js';
import type {
  IInvoiceLifecycleRepository,
  InvoiceLifecycleSnapshot
} from '../../../ports/invoice-lifecycle-repository.port.js';

export type InvoiceAppSyncFieldName =
  | 'createInvoiceDraft'
  | 'confirmInvoiceExtraction'
  | 'commitInvoiceLifecycle'
  | 'rejectInvoice'
  | 'retryInvoiceProcessing'
  | 'getInvoiceLifecycle';

export interface InvoiceAppSyncAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

export interface HandleInvoiceAppSyncRequestInput {
  readonly requestId: string;
  readonly fieldName: string;
  readonly auth: InvoiceAppSyncAuthContext;
  readonly args: Record<string, unknown>;
}

/** Output canónico — el handler de infraestructura serializa a AWSJSON. */
export interface InvoiceMutationResponse {
  readonly success: boolean;
  readonly message?: string;
  readonly invoiceId?: string;
  readonly version?: number;
  readonly status?: InvoiceLifecycleState;
  readonly updatedAt?: string;
  readonly correlationId?: string;
}

export interface HandleInvoiceAppSyncRequestDeps {
  readonly createInvoiceDraft: CreateInvoiceDraftUseCase;
  readonly confirmInvoiceExtraction: ConfirmInvoiceExtractionUseCase;
  readonly commitInvoiceLifecycle: CommitInvoiceLifecycleUseCase;
  readonly rejectInvoice: RejectInvoiceUseCase;
  readonly retryInvoiceProcessing: RetryInvoiceProcessingUseCase;
  readonly repository: IInvoiceLifecycleRepository;
}

const KNOWN_FIELDS: ReadonlySet<InvoiceAppSyncFieldName> = new Set([
  'createInvoiceDraft',
  'confirmInvoiceExtraction',
  'commitInvoiceLifecycle',
  'rejectInvoice',
  'retryInvoiceProcessing',
  'getInvoiceLifecycle'
]);

export function isInvoiceAppSyncFieldName(name: string): name is InvoiceAppSyncFieldName {
  return KNOWN_FIELDS.has(name as InvoiceAppSyncFieldName);
}

export class HandleInvoiceAppSyncRequestUseCase {
  constructor(private readonly deps: HandleInvoiceAppSyncRequestDeps) {}

  async execute(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse | InvoiceLifecycleSnapshot | null> {
    if (!isInvoiceAppSyncFieldName(input.fieldName)) {
      throw new ApplicationValidationError(
        `handleInvoiceAppSyncRequest: unsupported fieldName "${input.fieldName}"`
      );
    }

    switch (input.fieldName) {
      case 'createInvoiceDraft':
        return this.handleCreateDraft(input);
      case 'confirmInvoiceExtraction':
        return this.handleConfirm(input);
      case 'commitInvoiceLifecycle':
        return this.handleCommit(input);
      case 'rejectInvoice':
        return this.handleReject(input);
      case 'retryInvoiceProcessing':
        return this.handleRetry(input);
      case 'getInvoiceLifecycle':
        return this.handleGetLifecycle(input);
    }
  }

  private async handleCreateDraft(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse> {
    const payload = (input.args.input ?? {}) as CreateInvoiceDraftInput;
    const result = await this.deps.createInvoiceDraft.execute({
      auth: input.auth,
      input: payload,
      correlationId: input.requestId
    });
    return {
      success: true,
      invoiceId: result.invoiceId,
      version: result.version,
      status: result.status,
      updatedAt: result.createdAt,
      correlationId: input.requestId
    };
  }

  private async handleConfirm(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse> {
    const payload = (input.args.input ?? {}) as ConfirmInvoiceExtractionInput;
    const result = await this.deps.confirmInvoiceExtraction.execute({
      auth: input.auth,
      input: payload,
      correlationId: input.requestId
    });
    return {
      success: true,
      invoiceId: result.invoiceId,
      version: result.newVersion,
      status: result.status,
      updatedAt: result.persistedAt,
      message: result.hadCorrections ? 'Confirmed with user corrections' : 'Confirmed as-is',
      correlationId: input.requestId
    };
  }

  private async handleCommit(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse> {
    const payload = (input.args.input ?? {}) as CommitInvoiceLifecycleInput;
    const result = await this.deps.commitInvoiceLifecycle.execute({
      auth: input.auth,
      input: payload,
      correlationId: input.requestId
    });
    return {
      success: true,
      invoiceId: result.invoiceId,
      version: result.newVersion,
      status: result.status,
      updatedAt: result.persistedAt,
      message: result.hadCorrections
        ? 'Wizard committed with user corrections'
        : 'Wizard committed as-is',
      correlationId: input.requestId
    };
  }

  private async handleReject(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse> {
    const payload = (input.args.input ?? {}) as RejectInvoiceInput;
    const result = await this.deps.rejectInvoice.execute({
      auth: input.auth,
      input: payload,
      correlationId: input.requestId
    });
    return {
      success: true,
      invoiceId: result.invoiceId,
      version: result.newVersion,
      status: result.status,
      updatedAt: result.rejectedAt,
      correlationId: input.requestId
    };
  }

  private async handleRetry(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceMutationResponse> {
    const payload = (input.args.input ?? {}) as RetryInvoiceProcessingInput;
    const result = await this.deps.retryInvoiceProcessing.execute({
      auth: input.auth,
      input: payload,
      correlationId: input.requestId
    });
    return {
      success: true,
      invoiceId: result.invoiceId,
      version: result.newVersion,
      status: result.status,
      updatedAt: result.retriedAt,
      correlationId: result.correlationId
    };
  }

  private async handleGetLifecycle(
    input: HandleInvoiceAppSyncRequestInput
  ): Promise<InvoiceLifecycleSnapshot | null> {
    const invoiceId = String(input.args.invoiceId ?? input.args.id ?? '').trim();
    if (!invoiceId) {
      throw new ApplicationValidationError('getInvoiceLifecycle: invoiceId required');
    }
    return this.deps.repository.getLifecycleSnapshot({
      tenantId: input.auth.tenantId,
      orgId: input.auth.orgId,
      invoiceId
    });
  }
}
