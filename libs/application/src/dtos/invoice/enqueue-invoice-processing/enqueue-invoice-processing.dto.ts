/**
 * DTOs del use case `EnqueueInvoiceProcessingUseCase`.
 *
 * Importante: estas estructuras NO heredan tipos AWS (`SQSEvent`, etc.).
 * El handler-adaptador de infraestructura traduce el evento crudo a este DTO,
 * de modo que el caso de uso no sepa siquiera que existe SQS.
 */

export interface EnqueueInvoiceProcessingInputDto {
  readonly requestId: string;
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
  /** Metadatos opcionales propagados al mensaje (auditoría, correlation). */
  readonly metadata?: Record<string, unknown>;
}

export interface EnqueueInvoiceProcessingOutputDto {
  readonly invoiceId: string;
  readonly enqueuedAt: string;
}
