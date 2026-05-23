import type { InvoiceGoldenRecord } from '../use-cases/invoice/types/invoice-golden-record.types.js';

/**
 * Driven port: persistencia transaccional del Golden Record sobre el skeleton
 * existente en DynamoDB. El adaptador debe mantener la condición
 * `attribute_exists(PK)` para no sobrescribir registros que aún no fueron
 * dispatchados.
 */
export interface IInvoiceGoldenRecordRepository {
  persistGoldenRecord(record: InvoiceGoldenRecord): Promise<void>;
}
