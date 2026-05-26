import { randomUUID } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  CommitInvoiceLifecycleUseCase,
  ConfirmInvoiceExtractionUseCase,
  CreateInvoiceDraftUseCase,
  HandleInvoiceAppSyncRequestUseCase,
  RejectInvoiceUseCase,
  RetryInvoiceProcessingUseCase,
  isInvoiceAppSyncFieldName
} from '@sms/application';

import { DynamoInvoiceLifecycleRepository } from '../adapters/database/repositories/dynamo-invoice-lifecycle.repository.js';
import { SqsInvoiceProcessingQueueAdapter } from '../adapters/services/aws/invoice/sqs-invoice-processing-queue.adapter.js';
import {
  createAppSyncNodeConfigHandler,
  type CreateHandleAppSyncRequestUseCaseParams
} from './appsync-node-config.factory.js';
import type { AppSyncLambdaEvent } from '../adapters/services/aws/appsync/appsync-event.parser.js';
import {
  mergePartitionContextFromGraphQLArgs,
  resolvePartitionContextFromEvent
} from '../adapters/services/aws/appsync/appsync-event.parser.js';

export type CreateInvoiceLifecycleStackParams = {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly sqsQueueUrl?: string;
};

export function createInvoiceLifecycleRepository(
  params: CreateInvoiceLifecycleStackParams
): DynamoInvoiceLifecycleRepository {
  return new DynamoInvoiceLifecycleRepository({
    doc: params.doc,
    tableName: params.tableName
  });
}

export function createHandleInvoiceAppSyncRequestUseCase(
  params: CreateInvoiceLifecycleStackParams
): HandleInvoiceAppSyncRequestUseCase {
  const repository = createInvoiceLifecycleRepository(params);
  const queueWriter = new SqsInvoiceProcessingQueueAdapter({ queueUrl: params.sqsQueueUrl });

  const clock = () => new Date().toISOString();

  return new HandleInvoiceAppSyncRequestUseCase({
    repository,
    createInvoiceDraft: new CreateInvoiceDraftUseCase({
      repository,
      invoiceIdGenerator: () => randomUUID(),
      clock
    }),
    confirmInvoiceExtraction: new ConfirmInvoiceExtractionUseCase({
      repository,
      clock
    }),
    commitInvoiceLifecycle: new CommitInvoiceLifecycleUseCase({
      repository,
      clock
    }),
    rejectInvoice: new RejectInvoiceUseCase({ repository, clock }),
    retryInvoiceProcessing: new RetryInvoiceProcessingUseCase({
      repository,
      queueWriter,
      clock,
      correlationIdGenerator: () => randomUUID()
    })
  });
}

/**
 * Handler unificado api_lambda: enruta fieldNames de Invoice al stack v2
 * y el resto al handler de Node Config existente.
 */
export type AppSyncApiCombinedHandler = (
  rawEvent: AppSyncLambdaEvent
) => Promise<unknown>;

export function createAppSyncApiCombinedHandler(
  params: CreateHandleAppSyncRequestUseCaseParams & CreateInvoiceLifecycleStackParams
): AppSyncApiCombinedHandler {
  const nodeHandler = createAppSyncNodeConfigHandler(params);
  const invoiceUseCase = createHandleInvoiceAppSyncRequestUseCase(params);

  return async (rawEvent: AppSyncLambdaEvent) => {
    const fieldName =
      rawEvent?.info?.fieldName ?? rawEvent?.fieldName ?? rawEvent?.methodName ?? 'unknown';

    if (isInvoiceAppSyncFieldName(fieldName)) {
      const event = rawEvent;
      const requestId = event?.requestContext?.requestId ?? 'internal';
      const partitionContext = mergePartitionContextFromGraphQLArgs(
        resolvePartitionContextFromEvent(event),
        (event.arguments ?? {}) as Record<string, unknown>
      );

      const userId =
        String(event.identity?.sub ?? '').trim() ||
        String(
          (event.identity?.claims as Record<string, unknown> | undefined)?.sub ?? ''
        ).trim();

      const userEmail =
        typeof (event.identity?.claims as Record<string, unknown> | undefined)?.email ===
        'string'
          ? String((event.identity?.claims as Record<string, unknown>).email)
          : undefined;

      if (!partitionContext.tenantId?.trim()) {
        return {
          success: false,
          message: 'custom:tenant_id required',
          id: null,
          nodeId: null,
          path: null,
          entity: null
        };
      }

      let orgId = partitionContext.organizationScopeId?.trim() ?? '';

      // Fallback dev/single-org: tenantId == orgId (gated por env var).
      if (!orgId && process.env.ALLOW_TENANT_AS_ORG_FALLBACK === 'true') {
        console.warn(
          '[MULTI_TENANT] organizationScopeId ausente; usando tenantId como orgId (ALLOW_TENANT_AS_ORG_FALLBACK).'
        );
        orgId = partitionContext.tenantId;
      }

      if (!orgId) {
        return {
          success: false,
          message:
            'Aislamiento: falta org scope. Define `custom:organization_id` en Cognito, ' +
            'envía `input.orgId` en la mutation, o habilita ALLOW_TENANT_AS_ORG_FALLBACK=true en api_lambda (single-org/dev).',
          id: null,
          nodeId: null,
          path: null,
          entity: null
        };
      }

      return invoiceUseCase.execute({
        requestId,
        fieldName,
        auth: {
          tenantId: partitionContext.tenantId,
          orgId,
          userId,
          userEmail
        },
        args: (event.arguments ?? {}) as Record<string, unknown>
      });
    }

    return nodeHandler(rawEvent);
  };
}
