import type { InvoiceGoldenRecord } from '../../types/invoice-golden-record.types.js';

/** Input plano del pipeline de procesamiento de una factura individual. */
export interface ProcessInvoicePipelineInputDto {
  readonly bucket: string;
  readonly key: string;
  readonly sk: string;
  readonly orgId: string;
}

/** Output exitoso del pipeline: el Golden Record persistido. */
export interface ProcessInvoicePipelineOutputDto {
  readonly status: 'READY_FOR_REVIEW';
  readonly goldenRecord: InvoiceGoldenRecord;
}
