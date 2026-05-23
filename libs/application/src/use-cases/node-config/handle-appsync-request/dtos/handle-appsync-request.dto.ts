import type { GraphQLNode, MutationResponse, PartitionContext } from '../../types/node-config.types.js';

export type AppSyncMethodName =
  | 'saveNode'
  | 'updateNode'
  | 'deleteNode'
  | 'getNode'
  | 'getTree'
  | 'getInvoice';

/**
 * Input contrato del use case: el handler ya normalizó el evento AppSync
 * (parser en infraestructura) y entrega `methodName`, `partitionContext`
 * (tenant+org) y los `args` originales del resolver.
 */
export interface HandleAppSyncRequestInputDto {
  readonly requestId: string;
  readonly methodName: string;
  readonly partitionContext: PartitionContext;
  readonly args: Record<string, unknown>;
}

/**
 * Output contrato: cualquiera de los tipos GraphQL emitidos por los resolvers
 * de configuración. AppSync hará el casting según el campo invocado.
 */
export type HandleAppSyncRequestOutputDto =
  | MutationResponse
  | GraphQLNode
  | GraphQLNode[]
  | null;
