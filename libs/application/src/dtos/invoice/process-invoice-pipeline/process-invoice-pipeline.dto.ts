import type { InvoiceExtractionDraft } from '@sms/common';

/** Input plano del pipeline de procesamiento de una factura individual. */
export interface ProcessInvoicePipelineInputDto {
  readonly bucket: string;
  readonly key: string;
  readonly sk: string;
  readonly orgId: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly correlationId: string;
}

/** Output exitoso del pipeline: extraction draft persistido. */
export interface ProcessInvoicePipelineOutputDto {
  readonly status: 'AI_VALIDATION_REQUIRED';
  readonly invoiceId: string;
  readonly extractionDraft: InvoiceExtractionDraft;
}
