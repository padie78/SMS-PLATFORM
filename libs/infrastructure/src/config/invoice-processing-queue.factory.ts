import {
  EnqueueInvoiceProcessingUseCase,
  type EnqueueInvoiceProcessingDeps,
  type IInvoiceProcessingQueueWriter
} from '@sms/application';

import { SqsInvoiceProcessingQueueAdapter } from '../adapters/services/aws/invoice/sqs-invoice-processing-queue.adapter.js';

export interface CreateEnqueueInvoiceProcessingUseCaseParams {
  /** URL completa de la cola SQS (`SQS_PROCESSING_QUEUE_URL`). */
  readonly queueUrl: string | undefined;
  /** Override del puerto (testing / migración a otro broker). */
  readonly queue?: IInvoiceProcessingQueueWriter;
  /** Inyectable para tests deterministas. */
  readonly clock?: EnqueueInvoiceProcessingDeps['clock'];
}

/**
 * Composition root del flujo de encolado de procesamiento de facturas.
 *
 * Ensambla el use case puro con el adapter SQS. Si la cola termina en
 * `.fifo`, el adapter usa `tenantId#orgId` como `MessageGroupId` por defecto.
 */
export function createEnqueueInvoiceProcessingUseCase(
  params: CreateEnqueueInvoiceProcessingUseCaseParams
): EnqueueInvoiceProcessingUseCase {
  const queue: IInvoiceProcessingQueueWriter =
    params.queue ?? new SqsInvoiceProcessingQueueAdapter({ queueUrl: params.queueUrl });

  return new EnqueueInvoiceProcessingUseCase({
    queue,
    ...(params.clock ? { clock: params.clock } : {})
  });
}
