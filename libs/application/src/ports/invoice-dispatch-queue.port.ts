/** Puerto driven: encolar factura para el worker (SQS u otro broker). */
export interface InvoiceDispatchQueuePort {
  enqueueInvoice(params: {
    bucket: string;
    key: string;
    orgId: string;
    tenantId: string;
    invoiceId: string;
    sk: string;
    requestId: string;
  }): Promise<void>;
}
