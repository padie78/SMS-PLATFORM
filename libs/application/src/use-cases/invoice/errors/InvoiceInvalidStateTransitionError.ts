import type { InvoiceLifecycleState } from '@sms/common';

/**
 * El cliente intentó una transición `A → B` que no está whitelisted en
 * `VALID_INVOICE_STATE_TRANSITIONS` (defensa-en-profundidad).
 *
 * El use case valida en aplicación antes de tocar DynamoDB para devolver un
 * mensaje claro y evitar la latencia del round-trip al repositorio.
 */
export class InvoiceInvalidStateTransitionError extends Error {
  readonly invoiceId: string;
  readonly from: InvoiceLifecycleState | string;
  readonly to: InvoiceLifecycleState | string;

  constructor(
    invoiceId: string,
    from: InvoiceLifecycleState | string,
    to: InvoiceLifecycleState | string
  ) {
    super(`Invoice ${invoiceId}: invalid transition ${String(from)} → ${String(to)}`);
    this.name = 'InvoiceInvalidStateTransitionError';
    this.invoiceId = invoiceId;
    this.from = from;
    this.to = to;
  }
}
