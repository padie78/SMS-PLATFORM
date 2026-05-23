/** Patch incremental de extracción IA (campos planos; el dominio valida invariantes). */
export interface RecordInvoiceIaExtractionInputDto {
  readonly tenantId: string;
  readonly orgId: string;
  readonly invoiceId: string;
  readonly patch: Record<string, unknown>;
}
