/** Datos sugeridos por el pipeline de extracción documental. */
export interface InvoiceExtractedData {
  readonly consumptionKwh: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalAmount: number;
}

/** Driven port: extracción de datos desde el documento crudo almacenado en S3. */
export interface IInvoiceExtractorService {
  extract(bucket: string, key: string): Promise<InvoiceExtractedData>;
}
