import {
  parsePresignedUploadUrlResult,
  safeParsePresignedUploadUrlInput
} from '@sms/common';
import { formatInvoiceUploadObjectKey } from '@sms/domain';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { IS3PresignedUploadUrlService } from '../../../ports/IS3PresignedUploadUrlService.js';
import type {
  CreatePresignedUploadUrlInputDto,
  CreatePresignedUploadUrlOutputDto
} from './dtos/create-presigned-upload-url.dto.js';

export type CreatePresignedUploadUrlDeps = {
  readonly presigner: IS3PresignedUploadUrlService;
  readonly uploadBucket: string | undefined;
  readonly defaultContentType: string;
  readonly expiresInSeconds: number;
};

const formatZodIssues = (
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>
): string =>
  issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

/**
 * Caso de uso puro: crea una URL PUT presignada para que el cliente suba el
 * archivo de factura directo a S3 (Green IT — evita doble salto por el lambda).
 *
 * Dependencias inyectadas (todas son contratos de la capa de aplicación):
 *   - `IS3PresignedUploadUrlService` para firmar el PUT.
 *
 * Reglas de negocio:
 *   1. El payload se valida vía Zod (`safeParsePresignedUploadUrlInput`).
 *   2. La key del objeto se calcula con un servicio de dominio
 *      (`formatInvoiceUploadObjectKey`), garantizando una convención única
 *      `uploads/{userId}/{invoiceId}__{filename}`.
 *   3. Si falta el bucket destino se lanza `ApplicationValidationError`
 *      (no continuamos con un firmado inválido).
 */
export class CreatePresignedUploadUrlUseCase {
  constructor(private readonly deps: CreatePresignedUploadUrlDeps) {}

  async execute(
    dto: CreatePresignedUploadUrlInputDto
  ): Promise<CreatePresignedUploadUrlOutputDto> {
    const parsed = safeParsePresignedUploadUrlInput(dto.input ?? {});
    if (!parsed.success) {
      throw new ApplicationValidationError(
        `${formatZodIssues(parsed.error.issues)} requestId=${dto.requestId}`
      );
    }

    if (!this.deps.uploadBucket) {
      throw new ApplicationValidationError(
        `UPLOAD_BUCKET environment variable is not defined. requestId=${dto.requestId}`
      );
    }

    const { invoiceId, fileName, fileType } = parsed.data;
    const key = formatInvoiceUploadObjectKey(dto.userId, invoiceId, fileName);
    const contentType = fileType || this.deps.defaultContentType;

    const uploadURL = await this.deps.presigner.presignPutObject({
      bucket: this.deps.uploadBucket,
      key,
      contentType,
      expiresInSeconds: this.deps.expiresInSeconds
    });

    return parsePresignedUploadUrlResult({
      uploadURL,
      key,
      userId: dto.userId,
      invoiceId,
      message: 'Presigned URL generated successfully.'
    });
  }
}
