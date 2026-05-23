/** Resultado de parsear `uploads/…/<INV#…>__filename` tras decodeURIComponent. */
export interface DecodedInvoiceUploadKeyDto {
  readonly invoiceSk: string;
  readonly objectKey: string;
}
