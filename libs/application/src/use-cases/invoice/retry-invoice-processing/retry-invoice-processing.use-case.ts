/**
 * Use case: reintentar el procesamiento de una invoice que falló.
 *
 * Transición permitida: `FAILED|ERROR|DLQ → RETRYING` y luego re-encolar el
 * mensaje SQS para que el worker la procese de nuevo.
 *
 * NO recrea el skeleton ni borra audit history. Sólo:
 *  1. Cambia status `FAILED → RETRYING` (version++).
 *  2. Llama al port `IInvoiceProcessingQueueWriter` para enqueue del mensaje
 *     SQS (con `s3Bucket`, `s3Key`, `invoiceId` y `requestId` nuevo).
 *  3. Cambia status `RETRYING → DISPATCHING` (defensive, indica que el
 *     mensaje fue publicado a la cola).
 */
import { z } from 'zod';
import {
  RetryInvoiceProcessingInputSchema,
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  type InvoiceLifecycleState,
  type RetryInvoiceProcessingInput
} from '@sms/common';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { IInvoiceLifecycleRepository } from '../../../ports/invoice-lifecycle-repository.port.js';
import type { IInvoiceProcessingQueueWriter } from '../../../ports/invoice-processing-queue-writer.port.js';
import { InvoiceNotFoundError } from '../errors/InvoiceNotFoundError.js';
import { InvoiceInvalidStateTransitionError } from '../errors/InvoiceInvalidStateTransitionError.js';

const RETRYABLE_FROM_STATES: ReadonlyArray<InvoiceLifecycleState> = [
  'FAILED',
  'ERROR',
  'DLQ',
  'PARTIAL_SUCCESS'
];

export interface RetryInvoiceProcessingAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

export interface RetryInvoiceProcessingDeps {
  readonly repository: IInvoiceLifecycleRepository;
  readonly queueWriter: IInvoiceProcessingQueueWriter;
  readonly clock: () => string;
  readonly correlationIdGenerator: () => string;
}

export interface RetryInvoiceProcessingRequest {
  readonly auth: RetryInvoiceProcessingAuthContext;
  readonly input: RetryInvoiceProcessingInput;
  readonly correlationId?: string;
}

export interface RetryInvoiceProcessingResult {
  readonly invoiceId: string;
  readonly newVersion: number;
  readonly status: InvoiceLifecycleState;
  readonly retriedAt: string;
  readonly correlationId: string;
}

export class RetryInvoiceProcessingUseCase {
  constructor(private readonly deps: RetryInvoiceProcessingDeps) {}

  async execute(req: RetryInvoiceProcessingRequest): Promise<RetryInvoiceProcessingResult> {
    if (!req.auth?.tenantId?.trim() || !req.auth?.orgId?.trim() || !req.auth?.userId?.trim()) {
      throw new ApplicationValidationError('retryInvoiceProcessing: auth claims required');
    }

    let parsed: RetryInvoiceProcessingInput;
    try {
      parsed = RetryInvoiceProcessingInputSchema.parse(req.input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApplicationValidationError(
          `retryInvoiceProcessing input invalid: ${err.issues.map((i) => i.message).join('; ')}`
        );
      }
      throw err;
    }

    const identity = {
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      invoiceId: parsed.invoiceId
    };
    const snapshot = await this.deps.repository.getLifecycleSnapshot(identity);
    if (!snapshot) {
      throw new InvoiceNotFoundError(parsed.invoiceId);
    }

    if (!RETRYABLE_FROM_STATES.includes(snapshot.meta.status)) {
      throw new InvoiceInvalidStateTransitionError(
        parsed.invoiceId,
        snapshot.meta.status,
        'RETRYING'
      );
    }

    if (!snapshot.meta.s3Bucket || !snapshot.meta.s3Key) {
      throw new ApplicationValidationError(
        `retryInvoiceProcessing: invoice ${parsed.invoiceId} has no S3 reference; cannot re-enqueue.`
      );
    }

    const now = this.deps.clock();
    const correlationId = req.correlationId ?? this.deps.correlationIdGenerator();
    const pk = buildInvoicePartitionKey(req.auth.tenantId, req.auth.orgId);

    // 1) Transición FAILED → RETRYING (acquire intent).
    const auditRetrying = buildAuditEntryItem({
      pk,
      invoiceId: parsed.invoiceId,
      timestamp: now,
      event: 'USER_RETRIED',
      actor: {
        type: 'USER',
        userId: req.auth.userId,
        userEmail: req.auth.userEmail,
        correlationId
      },
      fromStatus: snapshot.meta.status,
      toStatus: 'RETRYING',
      resultingVersion: snapshot.meta.version + 1,
      details: parsed.reason ?? 'User requested retry'
    });

    const intermediate = await this.deps.repository.transitionState({
      ...identity,
      expectedVersion: parsed.expectedVersion,
      allowedFromStates: RETRYABLE_FROM_STATES,
      toState: 'RETRYING',
      auditEntry: auditRetrying,
      snapshotPatch: {
        retryCount: (snapshot.meta.snapshot.retryCount ?? 0) + 1,
        failureReason: undefined
      }
    });

    // 2) Re-enqueue SQS message (idempotent: caller debe asegurar
    // MessageDeduplicationId si la cola es FIFO).
    await this.deps.queueWriter.enqueue({
      invoiceId: parsed.invoiceId,
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      s3Bucket: snapshot.meta.s3Bucket,
      s3Key: snapshot.meta.s3Key,
      enqueuedAt: this.deps.clock(),
      metadata: {
        correlationId,
        retryReason: parsed.reason,
        retryCount: (snapshot.meta.snapshot.retryCount ?? 0) + 1,
        triggeredBy: req.auth.userId
      }
    });

    // 3) Transición RETRYING → DISPATCHING (mensaje ya fue publicado).
    const auditDispatching = buildAuditEntryItem({
      pk,
      invoiceId: parsed.invoiceId,
      timestamp: this.deps.clock(),
      event: 'STATE_TRANSITION',
      actor: { type: 'SYSTEM_API', correlationId },
      fromStatus: 'RETRYING',
      toStatus: 'DISPATCHING',
      resultingVersion: intermediate.newVersion + 1,
      details: 'Re-enqueued for processing'
    });

    const finalResult = await this.deps.repository.transitionState({
      ...identity,
      expectedVersion: intermediate.newVersion,
      allowedFromStates: ['RETRYING'],
      toState: 'DISPATCHING',
      auditEntry: auditDispatching
    });

    return {
      invoiceId: parsed.invoiceId,
      newVersion: finalResult.newVersion,
      status: finalResult.newState,
      retriedAt: finalResult.updatedAt,
      correlationId
    };
  }
}
