/**
 * Puerto driven: el dispatcher S3 actualiza lifecycle v2 tras upload.
 */
export interface InvoiceDispatchLifecycleResult {
  readonly tenantId: string;
  readonly orgId: string;
  readonly invoiceId: string;
  readonly version: number;
  readonly status: string;
}

export interface InvoiceDispatchLifecyclePort {
  onInvoiceUploaded(params: {
    invoiceSk: string;
    bucket: string;
    key: string;
    requestId: string;
  }): Promise<InvoiceDispatchLifecycleResult>;
}
