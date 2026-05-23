/** Contrato de mensaje SQS oficial (`PENDING_WORKER`) producido por el dispatcher. */
export interface InvoiceDispatchQueueMessageDto {
  readonly bucket: string;
  readonly key: string;
  readonly orgId: string;
  readonly sk: string;
  readonly timestamp: string;
  readonly status: 'PENDING_WORKER';
}
