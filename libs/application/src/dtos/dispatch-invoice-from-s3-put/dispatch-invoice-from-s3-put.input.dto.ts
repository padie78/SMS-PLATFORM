/** Entrada del caso de uso: contexto S3 listo para orquestar despacho. */
export interface DispatchInvoiceFromS3PutInputDto {
  readonly requestId: string;
  readonly bucket: string;
  readonly invoiceSk: string;
  readonly objectKey: string;
}
