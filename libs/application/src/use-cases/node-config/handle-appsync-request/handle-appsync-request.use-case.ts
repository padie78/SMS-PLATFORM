import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type { INodeConfigRepository } from '../../../ports/INodeConfigRepository.js';
import type {
  HandleAppSyncRequestInputDto,
  HandleAppSyncRequestOutputDto
} from './dtos/handle-appsync-request.dto.js';
import {
  mapItemToGraphqlNode,
  metadataFromInput,
  mutationResponseFromItem,
  mutationResponseFromOrganizationSave
} from './mappers/handle-appsync-request.mapper.js';
import type {
  GraphQLNode,
  MutationResponse,
  PartitionContext,
  SaveNodeInput,
  UpdateNodePayload
} from '../types/node-config.types.js';

/** Asegura que el `organizationScopeId` está presente en el contexto. */
function assertOrgScope(ctx: PartitionContext, msg: string): void {
  if (!String(ctx.organizationScopeId ?? '').trim()) {
    throw new ApplicationValidationError(msg);
  }
}

interface SaveNodeArgs {
  readonly input?: Record<string, unknown>;
}
interface UpdateNodeArgs {
  readonly id?: string;
  readonly input?: Record<string, unknown>;
}
interface IdArg {
  readonly id?: string;
}
interface GetTreeArgs {
  readonly rootNodeId?: string;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Caso de uso "router" que mapea el `fieldName` AppSync a la operación de
 * configuración correspondiente. Contiene **sólo** lógica de orquestación,
 * delegando la persistencia a `INodeConfigRepository`.
 *
 * El handler AppSync (infraestructura) es responsable de:
 *  1. Normalizar el evento entrante.
 *  2. Resolver `partitionContext` (tenant + org) desde claims/args/env.
 *  3. Capturar errores y convertirlos a la forma esperada por AppSync.
 *
 * Esto deja el use case puro, fácil de testear sin AWS.
 */
export class HandleAppSyncRequestUseCase {
  constructor(private readonly deps: { readonly repo: INodeConfigRepository }) {}

  async execute(dto: HandleAppSyncRequestInputDto): Promise<HandleAppSyncRequestOutputDto> {
    const { methodName, partitionContext: ctx, args } = dto;

    switch (methodName) {
      case 'saveNode':
        return this.saveNode(ctx, args as SaveNodeArgs);
      case 'updateNode':
        return this.updateNode(ctx, args as UpdateNodeArgs);
      case 'deleteNode':
        return this.deleteNode(ctx, args as IdArg);
      case 'getNode':
        return this.getNode(ctx, args as IdArg);
      case 'getTree':
        return this.getTree(ctx, args as GetTreeArgs);
      case 'getInvoice':
        return null;
      default:
        throw new ApplicationValidationError(
          `Resolver "${methodName}" no implementado en el backend.`
        );
    }
  }

  private async saveNode(
    ctx: PartitionContext,
    args: SaveNodeArgs
  ): Promise<MutationResponse> {
    const inp = (args?.input ?? {}) as Record<string, unknown>;
    const nodeTypeUpper = asString(inp.nodeType).toUpperCase();

    if (nodeTypeUpper === 'ORGANIZATION') {
      const parentRaw = asString(inp.parentId).trim().toUpperCase() || 'ROOT';
      if (parentRaw && parentRaw !== 'ROOT') {
        throw new ApplicationValidationError(
          'La raíz ORGANIZATION exige parentId = ROOT (u omitir el campo).'
        );
      }
      if (!asString(ctx.tenantId).trim()) {
        throw new ApplicationValidationError(
          'custom:tenant_id es requerido para crear una organización.'
        );
      }
      const orgResult = await this.deps.repo.saveOrganizationRootNode(ctx.tenantId, {
        id: (inp.id as string | undefined) ?? undefined,
        nodeId: inp.nodeId as string | undefined,
        name: asString(inp.name),
        metadata: metadataFromInput(inp.metadata)
      });
      return mutationResponseFromOrganizationSave(orgResult);
    }

    assertOrgScope(
      ctx,
      'orgId en SaveNodeInput, custom:organization_id en el token o DEFAULT_ORGAN_SCOPE_ID en la Lambda es requerido para la PK.'
    );
    const parentId = inp.parentId;
    if (parentId == null || asString(parentId).trim() === '') {
      throw new ApplicationValidationError(
        'parentId es requerido para nodos distintos de ORGANIZATION.'
      );
    }

    const saveInput: SaveNodeInput = {
      id: (inp.id as string | undefined) ?? undefined,
      orgId: inp.orgId as string | undefined,
      parentId: asString(parentId),
      nodeType: asString(inp.nodeType),
      name: asString(inp.name),
      metadata: metadataFromInput(inp.metadata)
    };
    const raw = await this.deps.repo.saveNode(ctx, saveInput);
    if (!raw.success) {
      return {
        success: false,
        message: raw.message ?? 'saveNode no devolvió un ítem',
        id: null,
        nodeId: null,
        path: null,
        entity: null
      };
    }
    return mutationResponseFromItem(raw.item);
  }

  private async updateNode(
    ctx: PartitionContext,
    args: UpdateNodeArgs
  ): Promise<MutationResponse> {
    assertOrgScope(
      ctx,
      'orgId en la mutación, claims de organización o DEFAULT_ORGAN_SCOPE_ID requerido para la PK.'
    );
    if (!args?.id) {
      throw new ApplicationValidationError('El ID del nodo es requerido para actualizar');
    }
    const inp = (args.input ?? {}) as Record<string, unknown>;
    const payload: UpdateNodePayload = {
      ...(inp.name !== undefined && inp.name !== null ? { name: asString(inp.name) } : {}),
      ...(inp.metadata !== undefined && inp.metadata !== null
        ? { metadata: metadataFromInput(inp.metadata) }
        : {})
    };
    const r = await this.deps.repo.updateNode(ctx, args.id, payload);
    if (!r.success) {
      return {
        success: false,
        message: r.message ?? 'No se pudo actualizar el nodo',
        id: args.id,
        nodeId: null,
        path: null,
        entity: null
      };
    }
    return mutationResponseFromItem(r.data);
  }

  private async deleteNode(
    ctx: PartitionContext,
    args: IdArg
  ): Promise<MutationResponse> {
    assertOrgScope(
      ctx,
      'orgId en la mutación, claims de organización o DEFAULT_ORGAN_SCOPE_ID requerido para la PK.'
    );
    if (!args?.id) {
      throw new ApplicationValidationError('ID requerido para eliminar');
    }
    const r = await this.deps.repo.deleteNode(ctx, args.id);
    if (!r.success) {
      return {
        success: false,
        message: r.message ?? 'No se pudo eliminar el nodo',
        id: args.id,
        nodeId: null,
        path: null,
        entity: null
      };
    }
    return {
      success: true,
      message: r.message ?? null,
      id: args.id,
      nodeId: null,
      path: null,
      entity: null
    };
  }

  private async getNode(ctx: PartitionContext, args: IdArg): Promise<GraphQLNode | null> {
    assertOrgScope(
      ctx,
      'Falta el segmento ORG de la PK: pasá orgId en la query, custom:organization_id en el token, ' +
        'DEFAULT_ORGAN_SCOPE_ID en Lambda, o usá id con formato ORGANIZATION#<ID_REAL>.'
    );
    if (!args?.id) {
      throw new ApplicationValidationError('id es requerido');
    }
    const item = await this.deps.repo.getNode(ctx, args.id);
    return mapItemToGraphqlNode(item);
  }

  private async getTree(ctx: PartitionContext, args: GetTreeArgs): Promise<GraphQLNode[]> {
    assertOrgScope(
      ctx,
      'Falta el segmento ORG de la PK: pasá orgId, custom:organization_id, DEFAULT_ORGAN_SCOPE_ID en Lambda, ' +
        'o rootNodeId con formato ORGANIZATION#<ID_REAL> (el árbol infiere la org desde el SK raíz).'
    );

    let underPath: string | undefined;
    if (args?.rootNodeId) {
      const root = await this.deps.repo.getNode(ctx, args.rootNodeId);
      underPath = root?.path ?? undefined;
      if (underPath === undefined) {
        return [];
      }
    }

    const items = await this.deps.repo.listNodes(
      ctx,
      underPath ? { underPath } : {}
    );
    const out: GraphQLNode[] = [];
    for (const it of items) {
      const node = mapItemToGraphqlNode(it);
      if (node) out.push(node);
    }
    return out;
  }
}
