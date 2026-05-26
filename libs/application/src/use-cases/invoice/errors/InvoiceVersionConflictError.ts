/**
 * Optimistic locking falló: el cliente envió `expectedVersion` que no
 * coincide con la `version` actual en DynamoDB.
 *
 * Suele significar que dos clientes editaron el mismo invoice al mismo
 * tiempo (o que un retry del worker corrió mientras el humano confirmaba).
 * La UI debe reaccionar haciendo refetch y reintentando con la versión
 * actualizada.
 */
export class InvoiceVersionConflictError extends Error {
  readonly invoiceId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number | null;

  constructor(invoiceId: string, expectedVersion: number, actualVersion: number | null = null) {
    super(
      `Invoice ${invoiceId} version conflict: expected ${expectedVersion}, got ${
        actualVersion ?? 'unknown'
      }`
    );
    this.name = 'InvoiceVersionConflictError';
    this.invoiceId = invoiceId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
