import type { ProcessInvoicePipelineUseCase } from '../process-invoice-pipeline/process-invoice-pipeline.use-case.js';
import type {
  ProcessInvoiceQueueBatchFailureItem,
  ProcessInvoiceQueueBatchInputDto,
  ProcessInvoiceQueueBatchOutputDto
} from './dtos/process-invoice-queue-batch.dto.js';
import { ProcessInvoiceQueueBatchMapper } from './mappers/process-invoice-queue-batch.mapper.js';

export type ProcessInvoiceQueueBatchDeps = {
  readonly pipeline: ProcessInvoicePipelineUseCase;
};

/**
 * Caso de uso: orquestador del batch SQS del worker de ingesta.
 *
 * Política de errores:
 *  - Records con body inválido o campos faltantes → contabilizan como `skipped`
 *    y NO se devuelven en `batchItemFailures` (se descartan definitivamente
 *    de la cola, como hacía el flujo legacy con `ZodError` / `ValidationError`).
 *  - Records con error de pipeline (OCR/IA/DB) → se reportan en
 *    `batchItemFailures` para que SQS aplique el retry-policy y eventual DLQ.
 */
export class ProcessInvoiceQueueBatchUseCase {
  constructor(private readonly deps: ProcessInvoiceQueueBatchDeps) {}

  async execute(
    input: ProcessInvoiceQueueBatchInputDto
  ): Promise<ProcessInvoiceQueueBatchOutputDto> {
    const parsedRecords = ProcessInvoiceQueueBatchMapper.parseRecords(input);

    const failures: ProcessInvoiceQueueBatchFailureItem[] = [];
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of parsedRecords) {
      if (record.pipelineInput === null) {
        skipped += 1;
        continue;
      }

      try {
        const result = await this.deps.pipeline.execute(record.pipelineInput);
        if (!result.ok) {
          failed += 1;
          failures.push({ itemIdentifier: record.messageId });
          continue;
        }
        processed += 1;
      } catch {
        failed += 1;
        failures.push({ itemIdentifier: record.messageId });
      }
    }

    return {
      batchItemFailures: failures,
      processed,
      failed,
      skipped
    };
  }
}
