/** Idempotencia: el invoice ya tiene un skeleton registrado. */
export class InvoiceAlreadyExistsError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice with id "${invoiceId}" already exists`);
    this.name = 'InvoiceAlreadyExistsError';
  }
}
