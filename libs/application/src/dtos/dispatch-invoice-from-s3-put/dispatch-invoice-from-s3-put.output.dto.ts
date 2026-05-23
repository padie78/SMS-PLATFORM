/** Salida plana del dispatcher hacia el adaptador (sin entidades de dominio). */
export interface DispatchInvoiceFromS3PutOutputDto {
  readonly status: 'ENQUEUED';
  readonly invoiceId: string;
  readonly orgId: string;
  readonly key: string;
}

/** Alias histórico del contrato de respuesta del dispatcher. */
export type DispatcherEnqueueResultDto = DispatchInvoiceFromS3PutOutputDto;
