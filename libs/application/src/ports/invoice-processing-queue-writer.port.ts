/**
 * Mensaje canónico que viaja por la cola de procesamiento de facturas.
 *
 * Convención: campos *suficientes* para que el worker pueda hacer fetch del
 * documento desde S3 y reanudar el ciclo de vida del aggregate `Invoice`.
 * Cualquier metadato adicional (correlación, auditoría) viaja como `metadata`
 * (record plano serializable, no clases).
 */
export interface InvoiceProcessingQueueMessage {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
  /** ISO-8601, marca el lado emisor (no el broker). */
  readonly enqueuedAt: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Driven port: escritor hacia la cola de procesamiento (SQS / SNS / Kafka /
 * cualquier broker).
 *
 * Reglas:
 *  - El use case **no** debe conocer la URL de la cola ni el formato wire.
 *  - El adapter es responsable de serializar, validar tamaño máximo del
 *    broker, manejar atributos de mensaje y agrupar (FIFO group, etc.).
 */
export interface IInvoiceProcessingQueueWriter {
  enqueue(message: InvoiceProcessingQueueMessage): Promise<void>;
}
