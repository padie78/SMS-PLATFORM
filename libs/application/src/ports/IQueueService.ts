/** Payload técnico que el dispatcher entrega al worker de ingesta. */
export interface InvoiceQueueMessage {
  readonly invoiceId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
}

/** Driven port: publicación asíncrona hacia una cola o broker equivalente. */
export interface IQueueService {
  sendMessage(message: InvoiceQueueMessage): Promise<void>;
}
