import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  ApplicationValidationError,
  HandleAppSyncRequestUseCase,
  type HandleAppSyncRequestOutputDto,
  type INodeConfigRepository,
  type PartitionContext
} from '@sms/application';

import { DynamoNodeConfigRepository } from '../adapters/database/repositories/dynamo-node-config.repository.js';
import {
  type AppSyncLambdaEvent,
  mergePartitionContextFromGraphQLArgs,
  normalizeAppSyncLambdaEvent,
  resolvePartitionContextFromEvent
} from '../adapters/services/aws/appsync/appsync-event.parser.js';

export interface CreateHandleAppSyncRequestUseCaseParams {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
  /** Override del repositorio (testing). */
  readonly repo?: INodeConfigRepository;
}

/**
 * Construye el use case `HandleAppSyncRequest` ya cableado al repositorio
 * DynamoDB. Para flujos productivos, los lambdas deberían preferir
 * `createAppSyncNodeConfigHandler` (incluye el handler completo).
 */
export function createHandleAppSyncRequestUseCase(
  params: CreateHandleAppSyncRequestUseCaseParams
): HandleAppSyncRequestUseCase {
  const repo: INodeConfigRepository =
    params.repo ?? new DynamoNodeConfigRepository(params.doc, params.tableName);
  return new HandleAppSyncRequestUseCase({ repo });
}

/**
 * AppSync espera distintos tipos según el `fieldName`:
 *   `getTree` → LIST · `getNode|getInvoice` → Node|null · mutaciones → MutationResponse.
 * Este helper traduce errores a la forma esperada para no romper el contrato.
 */
function errorPayloadForFieldName(
  methodName: string,
  message: string
): HandleAppSyncRequestOutputDto {
  if (methodName === 'getTree') {
    console.warn(
      `[RESOLVER][${methodName}] ${message} (retornando [] para cumplir tipo LIST)`
    );
    return [];
  }
  if (methodName === 'getNode' || methodName === 'getInvoice') {
    console.warn(`[RESOLVER][${methodName}] ${message} (retornando null)`);
    return null;
  }
  return {
    success: false,
    message,
    id: null,
    nodeId: null,
    path: null,
    entity: null
  };
}

export type AppSyncNodeConfigHandler = (
  event: AppSyncLambdaEvent
) => Promise<HandleAppSyncRequestOutputDto>;

/**
 * Composition root completo: devuelve el handler thin listo para exportar
 * desde el lambda. Encapsula:
 *  1. Normalización del evento AppSync.
 *  2. Resolución de `PartitionContext` (tenant + org).
 *  3. Invocación del use case.
 *  4. Traducción de errores al contrato GraphQL esperado.
 */
export function createAppSyncNodeConfigHandler(
  params: CreateHandleAppSyncRequestUseCaseParams
): AppSyncNodeConfigHandler {
  const useCase = createHandleAppSyncRequestUseCase(params);

  return async (rawEvent: AppSyncLambdaEvent) => {
    const event = normalizeAppSyncLambdaEvent(rawEvent);
    const requestId =
      event?.requestContext?.requestId || rawEvent?.requestContext?.requestId || 'internal';
    const methodName =
      event?.info?.fieldName ?? rawEvent?.fieldName ?? event?.methodName ?? 'unknown';
    const args = (event?.arguments ?? rawEvent?.arguments ?? {}) as Record<string, unknown>;

    let partitionContext: PartitionContext;
    try {
      partitionContext = mergePartitionContextFromGraphQLArgs(
        resolvePartitionContextFromEvent(event),
        args
      );
    } catch (ctxErr) {
      if (ctxErr instanceof ApplicationValidationError) {
        return errorPayloadForFieldName(methodName, ctxErr.message);
      }
      throw ctxErr;
    }

    console.log(
      `[RESOLVER][START] Method: ${methodName} | tenantId=${partitionContext.tenantId} | orgScope=${partitionContext.organizationScopeId} | Request: ${requestId}`
    );

    try {
      const result = await useCase.execute({
        requestId,
        methodName,
        partitionContext,
        args
      });
      console.log(`[RESOLVER][SUCCESS] Method: ${methodName}`);
      return result;
    } catch (error) {
      const msg = error instanceof Error && error.message ? error.message : 'Unknown error';
      console.error(`[RESOLVER][FATAL ERROR] Method: ${methodName} | Message: ${msg}`);

      if (error instanceof ApplicationValidationError) {
        return errorPayloadForFieldName(methodName, `Validación fallida: ${msg}`);
      }

      return errorPayloadForFieldName(
        methodName,
        'Ocurrió un error inesperado en el procesamiento.'
      );
    }
  };
}
