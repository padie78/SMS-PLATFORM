import {
  CreatePresignedUploadUrlUseCase,
  type CreatePresignedUploadUrlDeps
} from '@sms/application';
import { ApplicationValidationError } from '@sms/application';

import { S3PresignedUploadUrlAdapter } from '../adapters/services/aws/s3-presigned-upload-url.adapter.js';

export interface CreatePresignedUploadUrlHandlerParams {
  /** Región AWS para el cliente S3 (`AWS_REGION` típicamente). */
  readonly region: string;
  /** Bucket destino del PUT presignado (`UPLOAD_BUCKET`). */
  readonly uploadBucket: string | undefined;
  /** Content-Type a asumir si el cliente no envía `fileType`. */
  readonly defaultContentType?: string;
  /** Expiración de la URL en segundos. */
  readonly expiresInSeconds?: number;
  /** Override opcional del puerto (testing). */
  readonly presigner?: CreatePresignedUploadUrlDeps['presigner'];
}

const DEFAULT_CONTENT_TYPE = 'application/pdf';
const DEFAULT_EXPIRES_IN_SECONDS = 300;

/**
 * Builder interno del use case. Se mantiene privado para que los entrypoints
 * Lambda no importen ni "armen" casos de uso directamente.
 */
function buildCreatePresignedUploadUrlUseCase(
  params: CreatePresignedUploadUrlHandlerParams
): CreatePresignedUploadUrlUseCase {
  const presigner =
    params.presigner ??
    new S3PresignedUploadUrlAdapter({ region: params.region });

  return new CreatePresignedUploadUrlUseCase({
    presigner,
    uploadBucket: params.uploadBucket,
    defaultContentType: params.defaultContentType ?? DEFAULT_CONTENT_TYPE,
    expiresInSeconds: params.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS
  });
}

export type PresignedUploadUrlHandlerEvent = {
  readonly requestContext?: { readonly requestId?: string };
  readonly identity?: {
    readonly sub?: string;
    readonly claims?: { readonly sub?: string };
  };
  readonly arguments?: Record<string, unknown>;
};

export type PresignedUploadUrlHandler = (
  event: PresignedUploadUrlHandlerEvent
) => Promise<unknown>;

/**
 * Primary adapter del signer. Traduce el evento AppSync al DTO plano del use
 * case y aplica la política de errores esperada por GraphQL.
 */
export function createPresignedUploadUrlHandler(
  params: CreatePresignedUploadUrlHandlerParams
): PresignedUploadUrlHandler {
  const useCase = buildCreatePresignedUploadUrlUseCase(params);

  return async (event: PresignedUploadUrlHandlerEvent) => {
    const requestId = event?.requestContext?.requestId || 'internal';
    const userId = event?.identity?.claims?.sub || event?.identity?.sub || 'public';
    const input = event?.arguments || {};

    try {
      return await useCase.execute({ requestId, userId, input });
    } catch (error) {
      const msg = error instanceof Error && error.message ? error.message : 'Unknown error';
      console.error(`[SIGNER][FATAL] requestId=${requestId} err=${msg}`);

      if (error instanceof ApplicationValidationError) {
        throw new Error(msg);
      }

      throw new Error('Internal Signer Error');
    }
  };
}
