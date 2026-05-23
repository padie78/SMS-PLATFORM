import type { Invoice } from '@sms/domain';

/**
 * Driven port: persistencia del agregado Invoice.
 *
 * La firma plana asume que el agregado conserva el contexto requerido para que
 * el adaptador aplique aislamiento multitenant al persistir y consultar.
 */
export interface IInvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
}
