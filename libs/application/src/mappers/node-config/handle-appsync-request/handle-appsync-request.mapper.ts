import type {
  GraphQLNode,
  MutationResponse,
  NodeConfigItem,
  SaveOrganizationRootResult
} from '../../../use-cases/node-config/types/node-config.types.js';

/**
 * Adaptadores de salida: traducen estructuras del repositorio (`NodeConfigItem`,
 * resultados `success/failure`) al contrato GraphQL esperado por AppSync.
 *
 * Mantenerlos como funciones puras facilita testing y reuso desde resolvers
 * granulares (futura división del switch en use cases por operación).
 */

function metadataToString(meta: unknown): string | null {
  if (meta == null) return null;
  if (typeof meta === 'string') return meta;
  return JSON.stringify(meta);
}

/**
 * Filtra atributos internos (`PK`, `holdingId`) antes de devolver el ítem al
 * cliente GraphQL. `PK`/`holdingId` codifican `TENANT#…#ORG#…`, considerados
 * datos sensibles de aislamiento multi-tenant; `SK` ya se expone como `id`.
 */
function sanitizeItemForResponse(item: NodeConfigItem): Record<string, unknown> {
  const {
    PK: _pk,
    holdingId: _hid,
    ...publicFields
  } = item as NodeConfigItem & { PK?: unknown; holdingId?: unknown };
  return publicFields;
}

/**
 * Acepta `metadata` proveniente de GraphQL (string JSON, objeto plano o `null`)
 * y la normaliza a `Record<string, unknown>`. Devuelve `{}` si la entrada no
 * es serializable o JSON inválido.
 */
export function metadataFromInput(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return {};
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function mapItemToGraphqlNode(item: NodeConfigItem | null | undefined): GraphQLNode | null {
  if (!item) return null;
  const nodeType = item.entityType ?? item.nodeType ?? '';
  return {
    id: item.SK,
    parentId: item.parentId ?? null,
    path: item.path,
    nodeType,
    name: item.name,
    metadata: metadataToString(item.metadata)
  };
}

export function mutationResponseFromItem(item: NodeConfigItem | null | undefined): MutationResponse {
  if (!item) {
    return {
      success: false,
      message: 'Operación no produjo resultado',
      id: null,
      nodeId: null,
      path: null,
      entity: null
    };
  }
  return {
    success: true,
    message: null,
    id: item.SK ?? null,
    nodeId: null,
    path: item.path ?? null,
    entity: JSON.stringify(sanitizeItemForResponse(item))
  };
}

/** Respuesta del alta ORGANIZATION (incluye `nodeId` para redirección frontend). */
export function mutationResponseFromOrganizationSave(
  result: SaveOrganizationRootResult
): MutationResponse {
  if (!result.success) {
    return {
      success: false,
      message: result.message ?? 'saveOrganization no devolvió un ítem',
      id: null,
      nodeId: null,
      path: null,
      entity: null
    };
  }
  return {
    success: true,
    message: null,
    id: result.item.SK ?? null,
    nodeId: result.nodeId ?? null,
    path: result.path ?? result.item.path ?? null,
    entity: JSON.stringify(sanitizeItemForResponse(result.item))
  };
}
