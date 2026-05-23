/**
 * Driven port: generación de URLs PUT presignadas hacia un object store
 * (S3 u equivalente). El adaptador concreto inyecta credenciales y firma
 * el request con la duración indicada.
 */
export interface IS3PresignedUploadUrlService {
  presignPutObject(params: {
    readonly bucket: string;
    readonly key: string;
    readonly contentType: string;
    readonly expiresInSeconds: number;
  }): Promise<string>;
}
