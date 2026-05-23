/**
 * Tipos compartidos del módulo de configuración multi-tenant
 * (jerarquía REGION/BRANCH/BUILDING/COST_CENTER/ASSET/METER bajo ORGANIZATION).
 *
 * Estos tipos los consumen ambos: el use case `HandleAppSyncRequestUseCase`
 * (orquesta) y los adaptadores de infraestructura (`DynamoNodeConfigRepository`,
 * parser de eventos AppSync). Por eso viven en `application`.
 */

/**
 * Contexto de partición resuelto a partir del evento AppSync. Identifica
 * (de forma univoca) la PK de DynamoDB para todos los nodos de una
 * organización dentro de un tenant.
 */
export interface PartitionContext {
  readonly tenantId: string;
  readonly organizationScopeId: string;
}

/** Fila en la single-table representando un nodo de configuración. */
export interface NodeConfigItem {
  readonly PK: string;
  readonly SK: string;
  readonly holdingId: string;
  readonly path: string;
  readonly entityType: string;
  readonly name: string;
  readonly parentId: string;
  readonly metadata: Record<string, unknown>;
  readonly last_updated: string;
  /** Compatibilidad con datos heredados (`entity_type` legacy). */
  readonly nodeType?: string;
  readonly entity_type?: string;
}

export interface SaveNodeInput {
  readonly id?: string;
  readonly orgId?: string;
  readonly parentId: string;
  readonly nodeType: string;
  readonly name: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateNodePayload {
  readonly name?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ListNodesFilter {
  readonly underPath?: string;
  readonly nodeType?: string;
}

export interface SaveOrganizationRootInput {
  readonly id?: string;
  readonly nodeId?: string;
  readonly name: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OperationFailure {
  readonly success: false;
  readonly message: string;
}

export interface SaveNodeSuccess {
  readonly success: true;
  readonly id: string;
  readonly path: string;
  readonly item: NodeConfigItem;
}

export interface SaveOrganizationRootSuccess {
  readonly success: true;
  readonly nodeId: string;
  readonly path: string;
  readonly item: NodeConfigItem;
}

export interface UpdateNodeSuccess {
  readonly success: true;
  readonly data: NodeConfigItem;
}

export interface DeleteNodeSuccess {
  readonly success: true;
  readonly message?: string;
}

export type SaveNodeResult = SaveNodeSuccess | OperationFailure;
export type SaveOrganizationRootResult = SaveOrganizationRootSuccess | OperationFailure;
export type UpdateNodeResult = UpdateNodeSuccess | OperationFailure;
export type DeleteNodeResult = DeleteNodeSuccess | OperationFailure;

/** Forma de salida ya alineada al schema GraphQL (`Node` type). */
export interface GraphQLNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly nodeType: string;
  readonly name: string;
  readonly metadata: string | null;
}

/** Forma de salida compatible con `MutationResponse` del schema. */
export interface MutationResponse {
  readonly success: boolean;
  readonly message: string | null;
  readonly id: string | null;
  readonly nodeId: string | null;
  readonly path: string | null;
  readonly entity: string | null;
}
