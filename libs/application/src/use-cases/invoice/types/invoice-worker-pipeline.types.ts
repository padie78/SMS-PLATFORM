import type { InvoiceDispatchQueueMessageDto } from '../../../dtos/dispatch-invoice-from-s3-put/invoice-dispatch-queue-message.dto.js';

/** Mensajes antiguos / tests sin `status` ni `timestamp` estrictos. */
export interface InvoiceWorkerLegacyQueueBodyDto {
  readonly bucket: string;
  readonly key: string;
  readonly orgId?: string;
  readonly sk?: string;
  readonly timestamp?: string;
  readonly status?: string;
  readonly [extra: string]: unknown;
}

/** Entrada normalizada hacia el pipeline del worker. */
export type InvoiceWorkerPipelineInputDto = (
  | InvoiceDispatchQueueMessageDto
  | (InvoiceWorkerLegacyQueueBodyDto & { readonly orgId: string; readonly sk?: string })
) &
  Record<string, unknown>;
