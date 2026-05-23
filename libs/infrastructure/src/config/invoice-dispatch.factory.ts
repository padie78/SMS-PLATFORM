import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DispatchInvoiceFromS3PutMapper,
  DispatchInvoiceFromS3PutUseCase,
  type DispatchInvoiceFromS3PutDeps,
  type DispatchInvoiceFromS3PutOutputDto
} from '@sms/application';
import { extractInvoiceMetadataFromS3Key } from '@sms/domain';

import { DynamoInvoiceDispatchSkeletonAdapter } from '../adapters/services/aws/invoice/dynamo-invoice-dispatch-skeleton.adapter.js';
import { S3InvoiceDispatchOrgResolverAdapter } from '../adapters/services/aws/invoice/s3-invoice-dispatch-org-resolver.adapter.js';
import { SqsInvoiceDispatchQueueAdapter } from '../adapters/services/aws/invoice/sqs-invoice-dispatch-queue.adapter.js';

export type CreateInvoiceDispatchUseCaseParams = {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly queueUrl: string | undefined;
};

/** Composition root del dispatcher S3 → skeleton + SQS. */
export function createDispatchInvoiceFromS3PutUseCase(
  params: CreateInvoiceDispatchUseCaseParams
): DispatchInvoiceFromS3PutUseCase {
  const deps: DispatchInvoiceFromS3PutDeps = {
    orgResolver: new S3InvoiceDispatchOrgResolverAdapter(),
    skeletonWriter: new DynamoInvoiceDispatchSkeletonAdapter(params.doc, params.tableName),
    invoiceQueue: new SqsInvoiceDispatchQueueAdapter({ queueUrl: params.queueUrl })
  };
  return new DispatchInvoiceFromS3PutUseCase(deps);
}

/** Forma mínima del evento S3 que recibe el lambda dispatcher. */
export type DispatchInvoiceFromS3PutLambdaEvent = {
  readonly Records?: ReadonlyArray<{
    readonly s3?: {
      readonly bucket?: { readonly name?: string };
      readonly object?: { readonly key?: string };
    };
  }>;
};

/** Contexto Lambda mínimo (solo `awsRequestId` para correlación). */
export type DispatchInvoiceFromS3PutLambdaContext = {
  readonly awsRequestId?: string;
};

export type DispatchInvoiceFromS3PutHandler = (
  event: DispatchInvoiceFromS3PutLambdaEvent,
  context?: DispatchInvoiceFromS3PutLambdaContext
) => Promise<DispatchInvoiceFromS3PutOutputDto>;

/**
 * Composition root completo: devuelve el handler thin listo para exportar
 * desde el lambda. Encapsula:
 *  1. Parseo del evento S3 (`Records[0]`).
 *  2. Decodificación de la upload key con la regla de dominio
 *     (`extractInvoiceMetadataFromS3Key`).
 *  3. Construcción del DTO vía `DispatchInvoiceFromS3PutMapper`.
 *  4. Ejecución del use case y unwrapping de `Result`.
 *
 * Mantiene la misma semántica de errores que el handler original: cualquier
 * `Result.fail` o `extractInvoiceMetadataFromS3Key` inválido se relanza para
 * que SQS / S3 → Lambda apliquen retry-policy o DLQ.
 */
export function createDispatchInvoiceFromS3PutHandler(
  params: CreateInvoiceDispatchUseCaseParams
): DispatchInvoiceFromS3PutHandler {
  const useCase = createDispatchInvoiceFromS3PutUseCase(params);

  return async (event, context) => {
    const record = event?.Records?.[0];
    const bucket = record?.s3?.bucket?.name;
    const rawKey = record?.s3?.object?.key;
    const requestId = context?.awsRequestId ?? 'internal';

    if (!bucket || !rawKey) {
      throw new Error('Invalid S3 event: missing bucket or object key');
    }

    const uploadKey = extractInvoiceMetadataFromS3Key(rawKey);

    const input = DispatchInvoiceFromS3PutMapper.toInputDto(
      { requestId, bucket, rawKey },
      DispatchInvoiceFromS3PutMapper.decodedUploadKeyFromDomain(uploadKey)
    );

    const result = await useCase.execute(input);

    if (!result.ok) {
      throw new Error(result.error);
    }

    return result.value;
  };
}
