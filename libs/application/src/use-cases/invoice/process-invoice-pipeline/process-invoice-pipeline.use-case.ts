import { Result, type Result as ResultType } from '@sms/common';

import type { IInvoiceAiAnalyzerService } from '../../../ports/invoice-ai-analyzer-service.port.js';
import type { IInvoiceCategoryClassifierService } from '../../../ports/invoice-category-classifier-service.port.js';
import type { IInvoiceGoldenRecordRepository } from '../../../ports/invoice-golden-record-repository.port.js';
import type { IInvoiceOcrService } from '../../../ports/invoice-ocr-service.port.js';
import type { IInvoiceStatusNotifierService } from '../../../ports/invoice-status-notifier-service.port.js';
import type { InvoiceEmissionCalculations } from '../types/invoice-ai-analysis.types.js';
import type {
  ProcessInvoicePipelineInputDto,
  ProcessInvoicePipelineOutputDto
} from '../../../dtos/invoice/process-invoice-pipeline/process-invoice-pipeline.dto.js';
import { buildInvoiceGoldenRecord } from '../../../mappers/invoice/process-invoice-pipeline/process-invoice-pipeline.mapper.js';

const READY_STATUS = 'READY_FOR_REVIEW' as const;
const FAILED_STATUS = 'FAILED' as const;
const PROCESSING_STATUS = 'PROCESSING' as const;
const OCR_COMPLETED_STATUS = 'OCR_COMPLETED' as const;
const AI_EXTRACTION_COMPLETED_STATUS = 'AI_EXTRACTION_COMPLETED' as const;
const AI_VALIDATION_REQUIRED_STATUS = 'AI_VALIDATION_REQUIRED' as const;
const NO_EMISSIONS_YET: InvoiceEmissionCalculations = { total_kg: 0, items: [] };

export type ProcessInvoicePipelineDeps = {
  readonly ocrService: IInvoiceOcrService;
  readonly categoryClassifier: IInvoiceCategoryClassifierService;
  readonly aiAnalyzer: IInvoiceAiAnalyzerService;
  readonly goldenRecordRepository: IInvoiceGoldenRecordRepository;
  readonly statusNotifier: IInvoiceStatusNotifierService;
};

/**
 * Caso de uso: pipeline completo de digitalización IA de una factura.
 *
 * Orquesta OCR → clasificación → análisis IA → mapeo a Golden Record →
 * persistencia → notificación push. Si cualquier paso falla, marca el
 * registro como `FAILED` vía notificador y propaga el error para que la
 * cola decida reintento o DLQ.
 */
export class ProcessInvoicePipelineUseCase {
  constructor(private readonly deps: ProcessInvoicePipelineDeps) {}

  async execute(
    input: ProcessInvoicePipelineInputDto
  ): Promise<ResultType<ProcessInvoicePipelineOutputDto, string>> {
    try {
      await this.notifyStatusSafely(input.sk, PROCESSING_STATUS, 'Pipeline started');

      const rawText = await this.deps.ocrService.extractText(input.bucket, input.key);
      if (!rawText) {
        throw new Error('OCR service returned empty content');
      }
      await this.notifyStatusSafely(input.sk, OCR_COMPLETED_STATUS, 'OCR completed');

      const detectedCategory = await this.deps.categoryClassifier.classifyCategory(rawText);
      const aiAnalysis = await this.deps.aiAnalyzer.analyzeInvoice(rawText, detectedCategory);
      await this.notifyStatusSafely(
        input.sk,
        AI_EXTRACTION_COMPLETED_STATUS,
        'AI structured extraction completed'
      );

      const goldenRecord = buildInvoiceGoldenRecord({
        orgId: input.orgId.startsWith('ORG#') ? input.orgId : `ORG#${input.orgId}`,
        sk: input.sk,
        aiAnalysis,
        emissions: NO_EMISSIONS_YET,
        status: READY_STATUS,
        category: detectedCategory,
        originalMetadata: { s3_key: input.key, bucket: input.bucket }
      });

      await this.deps.goldenRecordRepository.persistGoldenRecord(goldenRecord);

      await this.notifyReadyForReview(input.sk, aiAnalysis, AI_VALIDATION_REQUIRED_STATUS);

      return Result.ok({ status: AI_VALIDATION_REQUIRED_STATUS, goldenRecord });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pipeline error';
      await this.notifyFailureSafely(input.sk, message);
      throw error;
    }
  }

  private async notifyStatusSafely(
    invoiceId: string,
    status: string,
    message: string,
    payload: Record<string, unknown> | null = null
  ): Promise<void> {
    try {
      await this.deps.statusNotifier.notifyStatus({
        invoiceId,
        status,
        message,
        payload
      });
    } catch {
      // Canal lateral: nunca bloquea el pipeline.
    }
  }

  private async notifyReadyForReview(
    invoiceId: string,
    aiAnalysis: Awaited<ReturnType<IInvoiceAiAnalyzerService['analyzeInvoice']>>,
    status: string = READY_STATUS
  ): Promise<void> {
    const source = aiAnalysis.source_data ?? {};
    const tech = aiAnalysis.technical_ids ?? {};
    const totalAmountField = source.total_amount;
    const totalAmount =
      typeof totalAmountField === 'object' && totalAmountField !== null
        ? totalAmountField.total_with_tax ?? 0
        : totalAmountField ?? 0;

    const uiPayload: Record<string, unknown> = {
      vendor: source.vendor?.name ?? 'Unknown',
      invoice_date: source.invoice_date ?? source.date ?? null,
      invoice_number: source.invoice_number ?? null,
      billing_period: source.billing_period ?? {},
      currency: source.currency ?? 'EUR',
      total_amount: totalAmount,
      net_amount:
        typeof totalAmountField === 'object' && totalAmountField !== null
          ? totalAmountField.net_amount ?? source.net_amount ?? null
          : source.net_amount ?? null,
      tax_amount:
        typeof totalAmountField === 'object' && totalAmountField !== null
          ? totalAmountField.tax_amount ?? source.tax_amount ?? null
          : source.tax_amount ?? null,
      tariff: tech.tariff ?? null,
      cups: tech.cups ?? null,
      contract_reference: tech.contract_reference ?? null,
      contracted_power: {
        p1: tech.contracted_power_p1 ?? null,
        p2: tech.contracted_power_p2 ?? null
      },
      customer: source.customer ?? null,
      lines: aiAnalysis.emission_lines ?? []
    };

    try {
      await this.deps.statusNotifier.notifyStatus({
        invoiceId,
        status,
        message: 'Digitization complete — human validation required',
        payload: uiPayload
      });
    } catch {
      // El notifier debe absorber sus propios errores; aquí garantizamos
      // que un fallo de UI nunca rompa el use case (regla 4 — Green IT:
      // no rehacer cómputos por errores transitorios de canal lateral).
    }
  }

  private async notifyFailureSafely(invoiceId: string, reason: string): Promise<void> {
    try {
      await this.deps.statusNotifier.notifyStatus({
        invoiceId,
        status: FAILED_STATUS,
        message: `Error: ${reason}`,
        payload: null
      });
    } catch {
      // Idem: el fallo de la notificación nunca debe ocultar el error original.
    }
  }
}
