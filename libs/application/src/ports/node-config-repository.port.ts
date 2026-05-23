import type {
  DeleteNodeResult,
  ListNodesFilter,
  NodeConfigItem,
  PartitionContext,
  SaveNodeInput,
  SaveNodeResult,
  SaveOrganizationRootInput,
  SaveOrganizationRootResult,
  UpdateNodePayload,
  UpdateNodeResult
} from '../use-cases/node-config/types/node-config.types.js';

/**
 * Driven port: persistencia de nodos de configuración multi-tenant
 * (CRUD jerárquico sobre la single-table). Toda operación recibe el
 * `PartitionContext` (tenant + org) excepto la creación raíz, que necesita
 * sólo el `tenantId` (y emite el segmento ORG nuevo).
 */
export interface INodeConfigRepository {
  saveOrganizationRootNode(
    tenantId: string,
    input: SaveOrganizationRootInput
  ): Promise<SaveOrganizationRootResult>;

  saveNode(ctx: PartitionContext, input: SaveNodeInput): Promise<SaveNodeResult>;

  getNode(ctx: PartitionContext, sk: string): Promise<NodeConfigItem | null>;

  updateNode(
    ctx: PartitionContext,
    sk: string,
    updateData: UpdateNodePayload
  ): Promise<UpdateNodeResult>;

  deleteNode(ctx: PartitionContext, sk: string): Promise<DeleteNodeResult>;

  listNodes(ctx: PartitionContext, filter?: ListNodesFilter): Promise<NodeConfigItem[]>;
}
