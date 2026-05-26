/**
 * Use case: confirmar la extracción IA con/sin correcciones humanas y
 * persistir el `InvoiceGoldenRecord` definitivo.
 *
 * Flujo:
 *  1. Zod-parse del input (rechaza shapes inválidos antes de tocar DDB).
 *  2. Lee snapshot actual (META + último draft + golden si ya existe).
 *  3. Valida invariantes:
 *      a. version coincide con `expectedVersion`.
 *      b. status ∈ {AI_VALIDATION_REQUIRED, HUMAN_REVIEW_IN_PROGRESS,
 *                   HUMAN_VALIDATED, HUMAN_CORRECTED} (idempotente).
 *      c. `extractionDraftVersion` matchea el último draft persistido (evita
 *         que el humano confirme contra un draft viejo si el worker
 *         reprocesó mientras tanto).
 *      d. Si vienen `corrections[]` → `event = USER_CORRECTED`; sino
 *         `event = USER_CONFIRMED_NO_CHANGES`.
 *  4. Construye `InvoiceGoldenRecord` final.
 *  5. Construye `InvoiceAuditEntry` con corrections delta.
 *  6. Llama al repositorio `persistGoldenRecord` (TransactWriteItems):
 *      - UPDATE META (status=PERSISTED, version++)
 *      - PUT GOLDEN (ConditionExpression: attribute_not_exists(SK))
 *      - PUT AUDIT entry
 *  7. Devuelve resultado al resolver.
 *
 * Failure modes:
 *  - `InvoiceVersionConflictError` → la UI debe refetchear y reintentar.
 *  - `InvoiceInvalidStateTransitionError` → el invoice ya fue procesado o
 *    fue marcado como FAILED; no se puede confirmar desde el estado actual.
 *  - `InvoiceNotFoundError` → invoiceId desconocido en este tenant/org.
 */
import { z } from 'zod';
import {
  ConfirmInvoiceExtractionInputSchema,
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  isValidInvoiceStateTransition,
  type ConfirmInvoiceExtractionInput,
  type InvoiceConfidenceField,
  type InvoiceLifecycleState
} from '@sms/common';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { IInvoiceLifecycleRepository } from '../../../ports/invoice-lifecycle-repository.port.js';
import type { InvoiceGoldenRecord } from '../types/invoice-golden-record.types.js';
import { InvoiceNotFoundError } from '../errors/InvoiceNotFoundError.js';
import { InvoiceInvalidStateTransitionError } from '../errors/InvoiceInvalidStateTransitionError.js';

/** Estados desde los que es legal confirmar la extracción humana. */
const CONFIRMABLE_FROM_STATES: ReadonlyArray<InvoiceLifecycleState> = [
  'AI_VALIDATION_REQUIRED',
  'HUMAN_REVIEW_IN_PROGRESS',
  'HUMAN_VALIDATED',
  'HUMAN_CORRECTED',
  // PARTIAL_SUCCESS también es válido (el humano puede confirmar lo que la IA logró).
  'PARTIAL_SUCCESS'
];

const TARGET_STATE: InvoiceLifecycleState = 'PERSISTED';

export interface ConfirmInvoiceExtractionAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

export interface ConfirmInvoiceExtractionDeps {
  readonly repository: IInvoiceLifecycleRepository;
  readonly clock: () => string;
}

export interface ConfirmInvoiceExtractionRequest {
  readonly auth: ConfirmInvoiceExtractionAuthContext;
  readonly input: ConfirmInvoiceExtractionInput;
  readonly correlationId?: string;
}

export interface ConfirmInvoiceExtractionResult {
  readonly invoiceId: string;
  readonly newVersion: number;
  readonly status: InvoiceLifecycleState;
  readonly persistedAt: string;
  readonly hadCorrections: boolean;
}

const fieldValueAsNumber = (f: InvoiceConfidenceField | null | undefined): number => {
  if (!f) return 0;
  if (typeof f.numericValue === 'number') return f.numericValue;
  const parsed = Number(f.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fieldValueAsString = (f: InvoiceConfidenceField | null | undefined): string => {
  if (!f) return '';
  if (f.value != null) return f.value;
  if (typeof f.numericValue === 'number') return String(f.numericValue);
  return '';
};

export class ConfirmInvoiceExtractionUseCase {
  constructor(private readonly deps: ConfirmInvoiceExtractionDeps) {}

  async execute(req: ConfirmInvoiceExtractionRequest): Promise<ConfirmInvoiceExtractionResult> {
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
    if (!CONFIRMABLE_FROM_STATES.includes(currentState)) {
      throw new InvoiceInvalidStateTransitionError(parsed.invoiceId, currentState, TARGET_STATE);
    }
    if (!isValidInvoiceStateTransition(currentState, TARGET_STATE)) {
      // Defensa adicional contra divergencia entre matriz y lista whitelist.
      throw new InvoiceInvalidStateTransitionError(parsed.invoiceId, currentState, TARGET_STATE);
    }

    if (snapshot.meta.version !== parsed.expectedVersion) {
      // El repositorio devolverá el conflicto verdadero al hacer la transacción;
      // adelantamos aquí para fail-fast con un mensaje claro.
      throw new ApplicationValidationError(
        `confirmInvoiceExtraction: version conflict — expected ${parsed.expectedVersion}, current ${snapshot.meta.version}. Refetch and retry.`
      );
    }

    const latestDraft = snapshot.latestExtractionDraft;
    if (!latestDraft) {
      throw new ApplicationValidationError(
        `confirmInvoiceExtraction: no extraction draft found for invoice ${parsed.invoiceId}. ` +
          `The worker must complete AI extraction before confirmation.`
      );
    }
    if (latestDraft.version !== parsed.extractionDraftVersion) {
      throw new ApplicationValidationError(
        `confirmInvoiceExtraction: stale draft — UI used v${parsed.extractionDraftVersion}, ` +
          `worker produced v${latestDraft.version}. Refetch and retry.`
      );
    }

    const hadCorrections = parsed.corrections.length > 0;
    const now = this.deps.clock();
    const pk = buildInvoicePartitionKey(req.auth.tenantId, req.auth.orgId);

    const goldenRecord = this.buildGoldenRecord({
      pk,
      input: parsed,
      processedAt: now,
      sourceConfidence: latestDraft.overallConfidence
    });

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
      resultingVersion: snapshot.meta.version + 1,
      corrections: hadCorrections ? parsed.corrections : undefined,
      details:
        parsed.notes ??
        (hadCorrections
          ? `User corrected ${parsed.corrections.length} field(s) before confirmation`
          : 'User confirmed AI extraction without modifications'),
      metadata: {
        extractionDraftVersion: parsed.extractionDraftVersion,
        overallConfidence: latestDraft.overallConfidence
      }
    });

    const writeResult = await this.deps.repository.persistGoldenRecord({
      ...identity,
      expectedVersion: parsed.expectedVersion,
      allowedFromStates: CONFIRMABLE_FROM_STATES,
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
        confidenceScore: latestDraft.overallConfidence
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

  private assertAuth(auth: ConfirmInvoiceExtractionAuthContext): void {
    if (!auth?.tenantId?.trim()) {
      throw new ApplicationValidationError(
        'confirmInvoiceExtraction: tenantId requerido (custom:tenant_id)'
      );
    }
    if (!auth?.orgId?.trim()) {
      throw new ApplicationValidationError(
        'confirmInvoiceExtraction: orgId requerido (custom:organization_id)'
      );
    }
    if (!auth?.userId?.trim()) {
      throw new ApplicationValidationError('confirmInvoiceExtraction: userId requerido (sub)');
    }
  }

  private parseInput(input: ConfirmInvoiceExtractionInput): ConfirmInvoiceExtractionInput {
    try {
      return ConfirmInvoiceExtractionInputSchema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApplicationValidationError(
          `confirmInvoiceExtraction input invalid: ${err.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
      }
      throw err;
    }
  }

  private buildGoldenRecord(args: {
    pk: string;
    input: ConfirmInvoiceExtractionInput;
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

// Helpers exportados (test surface)
export const __test_helpers__ = { fieldValueAsNumber, fieldValueAsString };
