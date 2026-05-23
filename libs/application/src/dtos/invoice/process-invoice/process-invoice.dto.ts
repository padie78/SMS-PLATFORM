/** DTO plano extraído del mensaje de cola consumido por el worker. */
export interface ProcessInvoiceDto {
  readonly invoiceId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
}
