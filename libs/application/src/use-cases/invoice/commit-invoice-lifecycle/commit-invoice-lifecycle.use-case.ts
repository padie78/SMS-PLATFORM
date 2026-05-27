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
  type InvoiceExtractionDraft,
  type InvoiceLifecycleItem,
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
      sourceConfidence,
      meta: snapshot.meta,
      latestExtractionDraft: snapshot.latestExtractionDraft
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
    meta: InvoiceLifecycleItem;
    latestExtractionDraft: InvoiceExtractionDraft | null;
  }): InvoiceGoldenRecord {
    const { input } = args;
    const periodYear = Number(input.billingPeriodEnd.slice(0, 4));
    const periodMonth = Number(input.billingPeriodEnd.slice(5, 7));
    const totalDaysProrated = this.diffDaysInclusive(
      input.billingPeriodStart,
      input.billingPeriodEnd
    );
    const technicalHash =
      this.shortHash(
        args.latestExtractionDraft?.modelMeta.documentHashSha256 ??
          (args.meta.snapshot?.['documentHashSha256'] as string | undefined) ??
          input.wipSnapshotHash ??
          input.invoiceId
      );
    const s3Key = args.meta.s3Key?.trim() || '';
    const uploadDate = args.meta.createdAt || args.processedAt;
    const detectedRawValues = this.buildDetectedRawValues(input);
    const missingFields = args.latestExtractionDraft?.missingFields ?? [];
    const suspiciousValues = args.latestExtractionDraft?.suspiciousValues ?? [];
    const requiresReview = input.requiresReview ?? args.sourceConfidence < 0.85;
    const activityId = input.activityId ?? this.defaultActivityId(input.energyType);
    const calculationMethod = input.calculationMethod ?? 'consumption_based';

    return {
      PK: args.pk,
      SK: this.buildAnalyticalInvoiceSk(input.vendorTaxId, input.invoiceNumber),
      ai_analysis: {
        activity_id: activityId,
        calculation_method: calculationMethod,
        confidence_score: args.sourceConfidence,
        requires_review: requiresReview,
        service_type: input.energyType,
        unit: input.consumptionUnit,
        value: input.consumptionValue,
        year: periodYear
      },
      analytics_dimensions: {
        asset_id: input.assetId ?? input.meterId ?? input.buildingId,
        branch_id: input.branchId,
        period_month: periodMonth,
        period_year: periodYear,
        sector: input.sector ?? 'COMMERCIAL'
      },
      climatiq_result: {
        co2e: 0,
        co2e_unit: 'kg',
        timestamp: args.processedAt
      },
      extracted_data: {
        billing_period: {
          start: input.billingPeriodStart,
          end: input.billingPeriodEnd
        },
        invoice_date: input.invoiceDate,
        invoice_number: input.invoiceNumber,
        total_amount: input.totalAmount,
        vendor: input.vendor,
        VENDOR_TAX_ID: input.vendorTaxId
      },
      metadata: {
        s3_key: s3Key,
        status: 'PROCESSED',
        technical_hash: technicalHash,
        thought_process: {
          detected_raw_values: detectedRawValues,
          missing_data_strategy:
            missingFields.length > 0
              ? `Missing fields reviewed during commit: ${missingFields.join(', ')}.`
              : 'No missing critical fields remained after human validation.',
          monetary_vs_physical_check:
            suspiciousValues.length > 0
              ? `Suspicious values were reviewed by the user before commit (${suspiciousValues.length} flagged).`
              : `Committed physical consumption ${input.consumptionValue} ${input.consumptionUnit}; monetary total ${input.totalAmount} ${input.currency}.`
        },
        upload_date: uploadDate,
        ingestion_source: args.meta.ingestionChannel ?? 'PORTAL',
        source_document_id: args.meta.SK,
        invoice_id: input.invoiceId,
        branch_id: input.branchId,
        building_id: input.buildingId,
        meter_id: input.meterId,
        cost_center_id: input.costCenterId,
        asset_id: input.assetId
      },
      processed_at: args.processedAt,
      total_days_prorated: totalDaysProrated
    };
  }

  private buildAnalyticalInvoiceSk(vendorTaxId: string, invoiceNumber: string): string {
    return `INV#${this.cleanSkSegment(vendorTaxId)}#${this.cleanSkSegment(invoiceNumber)}`;
  }

  private cleanSkSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'UNKNOWN';
  }

  private shortHash(value: string): string {
    return value.replace(/[^a-fA-F0-9]/g, '').slice(0, 8) || this.cleanSkSegment(value).slice(0, 8);
  }

  private diffDaysInclusive(startIso: string, endIso: string): number {
    const start = Date.parse(`${startIso}T00:00:00.000Z`);
    const end = Date.parse(`${endIso}T00:00:00.000Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return 0;
    }
    return Math.floor((end - start) / 86_400_000) + 1;
  }

  private buildDetectedRawValues(input: CommitInvoiceLifecycleInput): string[] {
    return [
      `${input.consumptionValue} ${input.consumptionUnit}`,
      `${input.totalAmount} ${input.currency}`,
      ...(input.subtotalAmount !== undefined ? [`${input.subtotalAmount} ${input.currency}`] : []),
      ...(input.taxAmount !== undefined ? [`${input.taxAmount} ${input.currency}`] : [])
    ];
  }

  private defaultActivityId(energyType: string): string {
    if (energyType === 'GAS') {
      return 'fuel_type_natural_gas-fuel_use_stationary_combustion';
    }
    if (energyType === 'ELECTRICITY') {
      return 'electricity-supply_grid-source_supplier_mix';
    }
    return 'unknown_activity';
  }
}
