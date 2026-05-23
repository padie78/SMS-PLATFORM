import type { PresignedUploadUrlInput, PresignedUploadUrlResult } from '@sms/common';

/**
 * Input plano del use case `CreatePresignedUploadUrlUseCase`.
 *
 * Convención: cualquier dato relevante para auditoría/correlación viaja en
 * campos explícitos. El `input` es el payload del cliente (mutaciones GraphQL),
 * que será re-validado con Zod dentro del use case.
 */
export interface CreatePresignedUploadUrlInputDto {
  readonly requestId: string;
  readonly userId: string;
  readonly input: PresignedUploadUrlInput | Record<string, unknown>;
}

/** Output: contrato `PresignedUploadUrlResult` ya validado. */
export type CreatePresignedUploadUrlOutputDto = PresignedUploadUrlResult;
