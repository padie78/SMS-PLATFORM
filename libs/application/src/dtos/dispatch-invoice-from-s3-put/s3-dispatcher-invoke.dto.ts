/** Contexto mínimo tras el primer record de un evento S3 → dispatcher (adaptador Lambda). */
export interface S3DispatcherInvokeDto {
  readonly requestId: string;
  readonly bucket: string;
  readonly rawKey: string;
}
