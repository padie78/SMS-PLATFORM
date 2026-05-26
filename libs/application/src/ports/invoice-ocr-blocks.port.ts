import type { InvoiceFieldGeometry } from '@sms/common';

/** Bloque OCR con texto y geometry para highlights en el wizard. */
export interface InvoiceOcrTextBlock {
  readonly text: string;
  readonly confidence: number;
  readonly page: number;
  readonly geometry: InvoiceFieldGeometry['boundingBox'];
}

export interface InvoiceOcrExtractionResult {
  readonly rawText: string;
  readonly blocks: ReadonlyArray<InvoiceOcrTextBlock>;
}

/**
 * Puerto OCR extendido: además del texto plano devuelve blocks con geometry.
 */
export interface IInvoiceOcrBlocksService {
  extractDocument(bucket: string, key: string): Promise<InvoiceOcrExtractionResult>;
}
