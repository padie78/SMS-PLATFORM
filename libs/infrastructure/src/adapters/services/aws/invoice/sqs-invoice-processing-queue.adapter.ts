import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type {
  IInvoiceProcessingQueueWriter,
  InvoiceProcessingQueueMessage
} from '@sms/application';

import { InfrastructureConfigError } from '../../../../exceptions/infrastructure-config.error.js';

export type SqsInvoiceProcessingQueueAdapterOptions = {
  /** URL completa de la cola SQS de procesamiento (`SQS_PROCESSING_QUEUE_URL`). */
  readonly queueUrl: string | undefined;
  /** Cliente SQS preconfigurado (override en testing). */
  readonly sqs?: SQSClient;
  /**
   * Si la cola es FIFO, el adapter usa este derivador para el `MessageGroupId`.
   * Garantiza orden por `invoiceId` y aislamiento entre tenants.
   */
  readonly messageGroupIdResolver?: (msg: InvoiceProcessingQueueMessage) => string;
  /** Si es FIFO, fija dedup ID para evitar duplicados in-flight. */
  readonly messageDeduplicationIdResolver?: (
    msg: InvoiceProcessingQueueMessage
  ) => string;
};

/**
 * Driven adapter (secondary): implementación SQS de
 * `IInvoiceProcessingQueueWriter`.
 *
 * Reglas:
 *  - Falla rápido (`InfrastructureConfigError`) si la URL no está configurada.
 *  - Serializa a JSON estable (sin claves indefinidas).
 *  - Adjunta `MessageAttributes` para que filtros downstream
 *    (e.g. EventBridge Pipes) puedan rutear sin parsear el cuerpo.
 */
export class SqsInvoiceProcessingQueueAdapter implements IInvoiceProcessingQueueWriter {
  private readonly queueUrl: string | undefined;
  private readonly sqs: SQSClient;
  private readonly groupIdResolver?: (msg: InvoiceProcessingQueueMessage) => string;
  private readonly dedupIdResolver?: (msg: InvoiceProcessingQueueMessage) => string;

  constructor(options: SqsInvoiceProcessingQueueAdapterOptions) {
    this.queueUrl = options.queueUrl;
    this.sqs = options.sqs ?? new SQSClient({});
    this.groupIdResolver = options.messageGroupIdResolver;
    this.dedupIdResolver = options.messageDeduplicationIdResolver;
  }

  async enqueue(message: InvoiceProcessingQueueMessage): Promise<void> {
    if (!this.queueUrl) {
      throw new InfrastructureConfigError(
        `SQS_PROCESSING_QUEUE_URL env var not set. invoiceId=${message.invoiceId}`
      );
    }

    const isFifo = this.queueUrl.endsWith('.fifo');
    const messageGroupId = isFifo
      ? this.groupIdResolver?.(message) ?? `${message.tenantId}#${message.orgId}`
      : undefined;
    const messageDeduplicationId =
      isFifo && this.dedupIdResolver ? this.dedupIdResolver(message) : undefined;

    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          tenantId: { DataType: 'String', StringValue: message.tenantId },
          orgId: { DataType: 'String', StringValue: message.orgId },
          invoiceId: { DataType: 'String', StringValue: message.invoiceId }
        },
        ...(messageGroupId ? { MessageGroupId: messageGroupId } : {}),
        ...(messageDeduplicationId ? { MessageDeduplicationId: messageDeduplicationId } : {})
      })
    );
  }
}
