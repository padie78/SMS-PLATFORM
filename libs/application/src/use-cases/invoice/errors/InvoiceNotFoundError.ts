/** El worker recibió un invoiceId para el que no existe skeleton persistido. */
export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice with id "${invoiceId}" was not found`);
    this.name = 'InvoiceNotFoundError';
  }
}
