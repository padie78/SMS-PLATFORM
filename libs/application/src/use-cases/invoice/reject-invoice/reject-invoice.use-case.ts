/**
 * Use case: rechazar una invoice (humano decide que el PDF no era válido
 * o la extracción es irrecuperable).
 *
 * Transición permitida: cualquier estado no-terminal → `FAILED`.
 * Persiste el motivo en el audit trail. NO crea Golden Record.
 */
import { z } from 'zod';
import {
  RejectInvoiceInputSchema,
  TERMINAL_INVOICE_STATES,
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  type InvoiceLifecycleState,
  type RejectInvoiceInput
} from '@sms/common';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { IInvoiceLifecycleRepository } from '../../../ports/invoice-lifecycle-repository.port.js';
import { InvoiceNotFoundError } from '../errors/InvoiceNotFoundError.js';
import { InvoiceInvalidStateTransitionError } from '../errors/InvoiceInvalidStateTransitionError.js';

const TARGET_STATE: InvoiceLifecycleState = 'FAILED';

export interface RejectInvoiceAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

export interface RejectInvoiceDeps {
  readonly repository: IInvoiceLifecycleRepository;
  readonly clock: () => string;
}

export interface RejectInvoiceRequest {
  readonly auth: RejectInvoiceAuthContext;
  readonly input: RejectInvoiceInput;
  readonly correlationId?: string;
}

export interface RejectInvoiceResult {
  readonly invoiceId: string;
  readonly newVersion: number;
  readonly status: InvoiceLifecycleState;
  readonly rejectedAt: string;
}

export class RejectInvoiceUseCase {
  constructor(private readonly deps: RejectInvoiceDeps) {}

  async execute(req: RejectInvoiceRequest): Promise<RejectInvoiceResult> {
    if (!req.auth?.tenantId?.trim() || !req.auth?.orgId?.trim() || !req.auth?.userId?.trim()) {
      throw new ApplicationValidationError('rejectInvoice: tenantId/orgId/userId required');
    }

    let parsed: RejectInvoiceInput;
    try {
      parsed = RejectInvoiceInputSchema.parse(req.input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApplicationValidationError(
          `rejectInvoice input invalid: ${err.issues.map((i) => i.message).join('; ')}`
        );
      }
      throw err;
    }

    const snapshot = await this.deps.repository.getLifecycleSnapshot({
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      invoiceId: parsed.invoiceId
    });
    if (!snapshot) {
      throw new InvoiceNotFoundError(parsed.invoiceId);
    }

    const current = snapshot.meta.status;
    if (TERMINAL_INVOICE_STATES.has(current) && current !== 'FAILED') {
      throw new InvoiceInvalidStateTransitionError(parsed.invoiceId, current, TARGET_STATE);
    }
    if (current === 'FAILED') {
      // Idempotente: ya está FAILED, devolvemos el snapshot actual sin reescribir.
      return {
        invoiceId: parsed.invoiceId,
        newVersion: snapshot.meta.version,
        status: 'FAILED',
        rejectedAt: snapshot.meta.updatedAt
      };
    }

    const now = this.deps.clock();
    const pk = buildInvoicePartitionKey(req.auth.tenantId, req.auth.orgId);

    const auditEntry = buildAuditEntryItem({
      pk,
      invoiceId: parsed.invoiceId,
      timestamp: now,
      event: 'USER_REJECTED',
      actor: {
        type: 'USER',
        userId: req.auth.userId,
        userEmail: req.auth.userEmail,
        correlationId: req.correlationId
      },
      fromStatus: current,
      toStatus: TARGET_STATE,
      resultingVersion: snapshot.meta.version + 1,
      details: parsed.reason
    });

    // Estados desde los que se permite rechazar: cualquiera excepto los
    // terminales (validado arriba).
    const allowedFromStates = (
      [
        'DRAFT',
        'UPLOADING',
        'UPLOADED',
        'REGISTERING',
        'REGISTERED',
        'DISPATCHING',
        'DISPATCHED',
        'QUEUED',
        'PROCESSING',
        'OCR_COMPLETED',
        'AI_EXTRACTION_COMPLETED',
        'AI_VALIDATION_REQUIRED',
        'HUMAN_REVIEW_IN_PROGRESS',
        'HUMAN_VALIDATED',
        'HUMAN_CORRECTED',
        'VALIDATING',
        'READY_FOR_PERSISTENCE',
        'PARTIAL_SUCCESS',
        'RETRYING'
      ] as const
    ).slice();

    const writeResult = await this.deps.repository.transitionState({
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      invoiceId: parsed.invoiceId,
      expectedVersion: parsed.expectedVersion,
      allowedFromStates,
      toState: TARGET_STATE,
      auditEntry,
      snapshotPatch: { failureReason: parsed.reason }
    });

    return {
      invoiceId: parsed.invoiceId,
      newVersion: writeResult.newVersion,
      status: writeResult.newState,
      rejectedAt: writeResult.updatedAt
    };
  }
}
