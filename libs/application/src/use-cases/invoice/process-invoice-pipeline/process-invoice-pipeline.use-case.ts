import { Result, type Result as ResultType, buildAuditEntryItem, buildInvoicePartitionKey } from '@sms/common';

import type { IInvoiceAiAnalyzerService } from '../../../ports/invoice-ai-analyzer-service.port.js';
import type { IInvoiceCategoryClassifierService } from '../../../ports/invoice-category-classifier-service.port.js';
import type { IInvoiceLifecycleRepository } from '../../../ports/invoice-lifecycle-repository.port.js';
import type { IInvoiceOcrBlocksService } from '../../../ports/invoice-ocr-blocks.port.js';
import type { IInvoiceStatusNotifierService } from '../../../ports/invoice-status-notifier-service.port.js';
import type {
  ProcessInvoicePipelineInputDto,
  ProcessInvoicePipelineOutputDto
} from '../../../dtos/invoice/process-invoice-pipeline/process-invoice-pipeline.dto.js';
import { buildExtractionDraftFromAiAnalysis } from '../../../mappers/invoice/process-invoice-pipeline/invoice-extraction-draft-from-ai.mapper.js';

const FAILED_STATUS = 'FAILED' as const;
const PROCESSING_STATUS = 'PROCESSING' as const;
const OCR_COMPLETED_STATUS = 'OCR_COMPLETED' as const;
const AI_EXTRACTION_COMPLETED_STATUS = 'AI_EXTRACTION_COMPLETED' as const;
const AI_VALIDATION_REQUIRED_STATUS = 'AI_VALIDATION_REQUIRED' as const;

const cleanInvoiceId = (skOrId: string): string =>
  skOrId.replace(/^INV#/, '').replace(/#META$/, '');

export type ProcessInvoicePipelineDeps = {
  readonly ocrService: IInvoiceOcrBlocksService;
  readonly categoryClassifier: IInvoiceCategoryClassifierService;
  readonly aiAnalyzer: IInvoiceAiAnalyzerService;
  readonly lifecycleRepository: IInvoiceLifecycleRepository;
  readonly statusNotifier: IInvoiceStatusNotifierService;
};

/**
 * Pipeline v2: OCR → IA → persistExtractionDraft → notificación AppSync.
 */
export class ProcessInvoicePipelineUseCase {
  constructor(private readonly deps: ProcessInvoicePipelineDeps) {}

  async execute(
    input: ProcessInvoicePipelineInputDto
  ): Promise<ResultType<ProcessInvoicePipelineOutputDto, string>> {
    const started = Date.now();
    const invoiceId = cleanInvoiceId(input.invoiceId || input.sk);
    const identity = {
      tenantId: input.tenantId,
      orgId: input.orgId,
      invoiceId
    };

    try {
      await this.notifyStatusSafely(invoiceId, PROCESSING_STATUS, 'Pipeline started', null);

      const ocrStarted = Date.now();
      const ocrResult = await this.deps.ocrService.extractDocument(input.bucket, input.key);
      const ocrLatencyMs = Date.now() - ocrStarted;

      if (!ocrResult.rawText) {
        throw new Error('OCR service returned empty content');
      }
      await this.notifyStatusSafely(invoiceId, OCR_COMPLETED_STATUS, 'OCR completed', null);

      const classifierStarted = Date.now();
      const detectedCategory = await this.deps.categoryClassifier.classifyCategory(ocrResult.rawText);
      const classifierLatencyMs = Date.now() - classifierStarted;

      const analyzerStarted = Date.now();
      const aiAnalysis = await this.deps.aiAnalyzer.analyzeInvoice(ocrResult.rawText, detectedCategory);
      const analyzerLatencyMs = Date.now() - analyzerStarted;

      await this.notifyStatusSafely(
        invoiceId,
        AI_EXTRACTION_COMPLETED_STATUS,
        'AI structured extraction completed',
        null
      );

      const snapshot = await this.deps.lifecycleRepository.getLifecycleSnapshot(identity);
      const expectedVersion = snapshot?.meta.version ?? 0;
      const extractionVersion = (snapshot?.meta.pointers?.latestExtractionDraftVersion ?? 0) + 1;

      const draft = buildExtractionDraftFromAiAnalysis({
        ...identity,
        version: extractionVersion,
        category: detectedCategory,
        aiAnalysis,
        pipelineRunId: input.correlationId,
        metrics: {
          totalLatencyMs: Date.now() - started,
          ocrLatencyMs,
          classifierLatencyMs,
          analyzerLatencyMs
        }
      });

      const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
      const now = new Date().toISOString();
      const auditEntry = buildAuditEntryItem({
        pk,
        invoiceId,
        timestamp: now,
        event: 'STATE_TRANSITION',
        actor: {
          type: 'SYSTEM_WORKER_PIPELINE',
          pipelineRunId: input.correlationId
        },
        fromStatus: snapshot?.meta.status ?? 'DISPATCHED',
        toStatus: 'AI_VALIDATION_REQUIRED',
        resultingVersion: expectedVersion + 1,
        details: 'Worker persisted extraction draft v2',
        metadata: { correlationId: input.correlationId, extractionVersion }
      });

      await this.deps.lifecycleRepository.persistExtractionDraft({
        ...identity,
        expectedVersion,
        allowedFromStates: [
          'DISPATCHED',
          'QUEUED',
          'PROCESSING',
          'OCR_COMPLETED',
          'AI_EXTRACTION_COMPLETED'
        ],
        toState: 'AI_VALIDATION_REQUIRED',
        extractionDraft: draft,
        auditEntry,
        snapshotPatch: {
          latestExtractionVersion: extractionVersion,
          overallConfidence: draft.overallConfidence
        }
      });

      const uiPayload: Record<string, unknown> = {
        invoiceId,
        extractionVersion,
        overallConfidence: draft.overallConfidence,
        vendor: draft.vendor.name.value,
        vendorTaxId: draft.vendor.taxId.value,
        invoiceNumber: draft.invoiceNumber.value,
        invoiceDate: draft.invoiceDate.value,
        totalAmount: draft.totalAmount.numericValue,
        currency: draft.currency.value,
        consumptionValue: draft.consumption.value.numericValue,
        consumptionUnit: draft.consumption.unit.value,
        warnings: draft.warnings,
        suspiciousValues: draft.suspiciousValues,
        fields: draft
      };

      await this.notifyStatusSafely(
        invoiceId,
        AI_VALIDATION_REQUIRED_STATUS,
        'Digitization complete — human validation required',
        uiPayload
      );

      return Result.ok({
        status: AI_VALIDATION_REQUIRED_STATUS,
        extractionDraft: draft,
        invoiceId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pipeline error';
      await this.notifyFailureSafely(invoiceId, message);
      throw error;
    }
  }

  private async notifyStatusSafely(
    invoiceId: string,
    status: string,
    message: string,
    payload: Record<string, unknown> | null
  ): Promise<void> {
    try {
      await this.deps.statusNotifier.notifyStatus({
        invoiceId: cleanInvoiceId(invoiceId),
        status,
        message,
        payload
      });
    } catch {
      // Canal lateral: nunca bloquea el pipeline.
    }
  }

  private async notifyFailureSafely(invoiceId: string, reason: string): Promise<void> {
    try {
      await this.deps.statusNotifier.notifyStatus({
        invoiceId: cleanInvoiceId(invoiceId),
        status: FAILED_STATUS,
        message: `Error: ${reason}`,
        payload: null
      });
    } catch {
      // Idem.
    }
  }
}
