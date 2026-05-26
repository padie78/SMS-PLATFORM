/**
 * Use case: COMMIT FINAL del wizard.
 *
 * El stepper acumuló todos los datos del usuario en su WIP store local
 * (Angular signal + sessionStorage). Mientras avanzaba por los steps no se
 * tocó la base persistente con datos del usuario. En el último step el FE
 * llama a `commitInvoiceLifecycle(input)` con el snapshot completo.
 *
 * Diferencias vs `confirmInvoiceExtraction`:
 *   - Acepta `expectedVersion = null` (FE recién montó el wizard y no
 *     conoce la versión actual del META).
 *   - Acepta `extractionDraftVersion = null` (entrada manual sin IA).
 *   - Promueve items WIP a permanentes (`isWip=false`, REMOVE ttl).
 *
 * Garantías:
 *   - UNA sola `TransactWriteItems` (atomic): META→PERSISTED+REMOVE ttl,
 *     PUT GOLDEN (attribute_not_exists), PUT AUDIT.
 *   - Si dos pestañas del browser hacen commit simultáneo, una ganará y la
 *     otra recibirá `InvoiceVersionConflictError` con HTTP 409.
 */
import { z } from 'zod';
import {
  CommitInvoiceLifecycleInputSchema,
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  type CommitInvoiceLifecycleInput,
  type InvoiceLifecycleState
} from '@sms/common';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { IInvoiceLifecycleRepository } from '../../../ports/invoice-lifecycle-repository.port.js';
import type { InvoiceGoldenRecord } from '../types/invoice-golden-record.types.js';
import { InvoiceNotFoundError } from '../errors/InvoiceNotFoundError.js';
import { InvoiceInvalidStateTransitionError } from '../errors/InvoiceInvalidStateTransitionError.js';

/**
 * Estados desde los que el wizard puede consolidar el invoice. Incluye los
 * estados "IA completada / humano revisando" pero también `UPLOADED` y
 * `DISPATCHED` para soportar el caso "entrada manual sin IA" (el FE sube el
 * PDF + carga todos los datos manualmente y omite el paso de revisión IA).
 */
const COMMITTABLE_FROM_STATES: ReadonlyArray<InvoiceLifecycleState> = [
  'UPLOADED',
  'DISPATCHED',
  'QUEUED',
  'PROCESSING',
  'OCR_COMPLETED',
  'AI_EXTRACTION_COMPLETED',
  'AI_VALIDATION_REQUIRED',
  'HUMAN_REVIEW_IN_PROGRESS',
  'HUMAN_VALIDATED',
  'HUMAN_CORRECTED',
  'PARTIAL_SUCCESS'
];

const TARGET_STATE: InvoiceLifecycleState = 'PERSISTED';

export interface CommitInvoiceLifecycleAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

export interface CommitInvoiceLifecycleDeps {
  readonly repository: IInvoiceLifecycleRepository;
  readonly clock: () => string;
}

export interface CommitInvoiceLifecycleRequest {
  readonly auth: CommitInvoiceLifecycleAuthContext;
  readonly input: CommitInvoiceLifecycleInput;
  readonly correlationId?: string;
}

export interface CommitInvoiceLifecycleResult {
  readonly invoiceId: string;
  readonly newVersion: number;
  readonly status: InvoiceLifecycleState;
  readonly persistedAt: string;
  readonly hadCorrections: boolean;
}

export class CommitInvoiceLifecycleUseCase {
  constructor(private readonly deps: CommitInvoiceLifecycleDeps) {}

  async execute(req: CommitInvoiceLifecycleRequest): Promise<CommitInvoiceLifecycleResult> {
    this.assertAuth(req.auth);
    const parsed = this.parseInput(req.input);

    const identity = {
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      invoiceId: parsed.invoiceId
    };

    const snapshot = await this.deps.repository.getLifecycleSnapshot(identity);
    if (!snapshot) {
      throw new InvoiceNotFoundError(parsed.invoiceId);
    }

    const currentState = snapshot.meta.status;
    if (!COMMITTABLE_FROM_STATES.includes(currentState)) {
      throw new InvoiceInvalidStateTransitionError(parsed.invoiceId, currentState, TARGET_STATE);
    }

    // Optimistic locking solo cuando el FE conoce la versión.
    if (parsed.expectedVersion !== null && snapshot.meta.version !== parsed.expectedVersion) {
      throw new ApplicationValidationError(
        `commitInvoiceLifecycle: version conflict — expected ${parsed.expectedVersion}, ` +
          `current ${snapshot.meta.version}. Refetch and retry.`
      );
    }

    // Validar coherencia con draft IA si el FE lo declara.
    if (parsed.extractionDraftVersion !== null) {
      const latestDraft = snapshot.latestExtractionDraft;
      if (latestDraft && latestDraft.version !== parsed.extractionDraftVersion) {
        throw new ApplicationValidationError(
          `commitInvoiceLifecycle: stale extraction draft — wizard saw v${parsed.extractionDraftVersion}, ` +
            `worker produced v${latestDraft.version}. Refetch and retry.`
        );
      }
    }

    const hadCorrections = parsed.corrections.length > 0;
    const now = this.deps.clock();
    const pk = buildInvoicePartitionKey(req.auth.tenantId, req.auth.orgId);
    const sourceConfidence = snapshot.latestExtractionDraft?.overallConfidence ?? 1;

    const goldenRecord = this.buildGoldenRecord({
      pk,
      input: parsed,
      processedAt: now,
      sourceConfidence
    });

    const resultingVersion = snapshot.meta.version + 1;
    const auditEntry = buildAuditEntryItem({
      pk,
      invoiceId: parsed.invoiceId,
      timestamp: now,
      event: hadCorrections ? 'USER_CORRECTED' : 'USER_CONFIRMED_NO_CHANGES',
      actor: {
        type: 'USER',
        userId: req.auth.userId,
        userEmail: req.auth.userEmail,
        correlationId: req.correlationId
      },
      fromStatus: currentState,
      toStatus: TARGET_STATE,
      resultingVersion,
      corrections: hadCorrections ? parsed.corrections : undefined,
      details:
        parsed.notes ??
        (hadCorrections
          ? `User committed wizard with ${parsed.corrections.length} correction(s)`
          : 'User committed wizard without IA correction (or manual entry)'),
      metadata: {
        commitSource: 'WIZARD_FINAL_STEP',
        extractionDraftVersion: parsed.extractionDraftVersion,
        wipSnapshotHash: parsed.wipSnapshotHash,
        overallConfidence: sourceConfidence
      }
    });

    const writeResult = await this.deps.repository.commitLifecycle({
      ...identity,
      expectedVersion: parsed.expectedVersion,
      allowedFromStates: COMMITTABLE_FROM_STATES,
      toState: TARGET_STATE,
      goldenRecord,
      auditEntry,
      snapshotPatch: {
        vendor: parsed.vendor,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        totalAmount: parsed.totalAmount,
        currency: parsed.currency,
        branchId: parsed.branchId,
        buildingId: parsed.buildingId,
        confidenceScore: sourceConfidence
      }
    });

    return {
      invoiceId: parsed.invoiceId,
      newVersion: writeResult.newVersion,
      status: writeResult.newState,
      persistedAt: writeResult.updatedAt,
      hadCorrections
    };
  }

  private assertAuth(auth: CommitInvoiceLifecycleAuthContext): void {
    if (!auth?.tenantId?.trim()) {
      throw new ApplicationValidationError(
        'commitInvoiceLifecycle: tenantId requerido (custom:tenant_id)'
      );
    }
    if (!auth?.orgId?.trim()) {
      throw new ApplicationValidationError(
        'commitInvoiceLifecycle: orgId requerido (custom:organization_id)'
      );
    }
    if (!auth?.userId?.trim()) {
      throw new ApplicationValidationError('commitInvoiceLifecycle: userId requerido (sub)');
    }
  }

  private parseInput(input: CommitInvoiceLifecycleInput): CommitInvoiceLifecycleInput {
    try {
      return CommitInvoiceLifecycleInputSchema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApplicationValidationError(
          `commitInvoiceLifecycle input invalid: ${err.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
      }
      throw err;
    }
  }

  private buildGoldenRecord(args: {
    pk: string;
    input: CommitInvoiceLifecycleInput;
    processedAt: string;
    sourceConfidence: number;
  }): InvoiceGoldenRecord {
    const { input } = args;
    return {
      PK: args.pk,
      SK: `INV#${input.invoiceId}#GOLDEN`,
      status: TARGET_STATE,
      processed_at: args.processedAt,
      updated_at: args.processedAt,
      analytics: {
        confidence_score: args.sourceConfidence,
        anomaly_detected: false
      },
      ai_analysis: {
        service_type: input.energyType,
        value: input.consumptionValue,
        unit: input.consumptionUnit,
        status_triage: 'DONE'
      },
      climatiq_result: {},
      extracted_data: {
        invoice_number: input.invoiceNumber,
        invoice_date: input.invoiceDate,
        vendor: input.vendor,
        customer: {},
        cups: null,
        contract_reference: null,
        contracted_power: { p1: null, p2: null },
        tariff: null,
        total_amount: input.totalAmount,
        tax_amount: input.taxAmount ?? 0,
        net_amount: input.subtotalAmount ?? input.totalAmount - (input.taxAmount ?? 0),
        currency: input.currency,
        billing_period: {
          start: input.billingPeriodStart,
          end: input.billingPeriodEnd
        },
        lines: []
      },
      metadata: {
        s3_key: null,
        is_draft: false,
        branchId: input.branchId,
        buildingId: input.buildingId,
        meterId: input.meterId,
        costCenterId: input.costCenterId,
        assetId: input.assetId
      }
    };
  }
}
