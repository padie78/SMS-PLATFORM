/**
 * Driven port: extracción OCR de un documento almacenado en S3.
 *
 * Implementación de referencia: AWS Textract (`TextractInvoiceOcrAdapter`).
 */
export interface IInvoiceOcrService {
  /**
   * Devuelve el texto crudo concatenado del documento.
   * @throws Error si la fuente no contiene texto detectable.
   */
  extractText(bucket: string, key: string): Promise<string>;
}
