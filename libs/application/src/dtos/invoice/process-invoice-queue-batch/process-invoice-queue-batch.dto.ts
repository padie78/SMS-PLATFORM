import type { ProcessInvoicePipelineInputDto } from '../process-invoice-pipeline/process-invoice-pipeline.dto.js';

/** Record SQS crudo recibido por el worker (tras `Records[]` del evento). */
export interface SqsBatchRecord {
  readonly messageId: string;
  readonly body: string;
}

/** Input plano del orquestador batch. */
export interface ProcessInvoiceQueueBatchInputDto {
  readonly records: ReadonlyArray<SqsBatchRecord>;
  readonly defaultOrgId: string;
}

/** Resultado parseado por record (puede ser inválido o saltado). */
export interface ParsedQueueRecord {
  readonly messageId: string;
  readonly pipelineInput: ProcessInvoicePipelineInputDto | null;
  readonly skipReason?: string;
}

/** Item del reporte de fallos en formato esperado por SQS partial batch failure. */
export interface ProcessInvoiceQueueBatchFailureItem {
  readonly itemIdentifier: string;
}

/** Output del orquestador batch (compatible con respuesta SQS partial batch). */
export interface ProcessInvoiceQueueBatchOutputDto {
  readonly batchItemFailures: ReadonlyArray<ProcessInvoiceQueueBatchFailureItem>;
  readonly processed: number;
  readonly failed: number;
  readonly skipped: number;
}
