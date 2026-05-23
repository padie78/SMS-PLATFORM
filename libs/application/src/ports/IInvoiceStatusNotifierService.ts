/** Datos opcionales que la UI consume al recibir el evento de actualización. */
export type InvoiceStatusNotificationPayload = Record<string, unknown> | null;

export interface InvoiceStatusNotificationInput {
  readonly invoiceId: string;
  readonly status: string;
  readonly message: string;
  readonly payload?: InvoiceStatusNotificationPayload;
}

/**
 * Driven port: emite un evento push a la UI (AppSync) avisando del cambio
 * de estado de la factura.
 *
 * El adaptador debe absorber sus propios fallos para que la notificación
 * nunca bloquee la persistencia del Golden Record.
 */
export interface IInvoiceStatusNotifierService {
  notifyStatus(input: InvoiceStatusNotificationInput): Promise<void>;
}
