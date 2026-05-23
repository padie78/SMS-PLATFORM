/** La entidad existe, pero su estado actual no admite procesamiento. */
export class InvoiceNotProcessableError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice with id "${invoiceId}" is not in a processable state`);
    this.name = 'InvoiceNotProcessableError';
  }
}
