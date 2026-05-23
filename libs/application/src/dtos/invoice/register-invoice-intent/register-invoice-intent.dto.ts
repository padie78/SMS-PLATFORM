/** DTO plano recibido por la mutación que registra la intención de ingesta. */
export interface RegisterInvoiceIntentDto {
  readonly invoiceId: string;
  readonly meterId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
  readonly uploadedBy: string;
}
