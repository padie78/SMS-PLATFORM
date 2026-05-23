/**
 * Single-table PK para nodos de jerarquía bajo multi-tenant Cognito.
 * Formato: `TENANT#<tenantId>#ORG#<organizationScopeId>`
 *
 * - `tenantId`: claim obligatorio `custom:tenant_id` (UUID o identificador estable).
 * - `organizationScopeId`: ID real de la organización (segmento ORG#);
 *   proviene de claims, `orgId` en GraphQL o env (DEFAULT_ORGAN_SCOPE_ID).
 *
 * Todos los SK (`ORGANIZATION#…`, `REGION#…`, …) comparten el mismo PK
 * dentro de esa organización.
 */

const NODE_TYPE_PREFIXES = [
  'ORGANIZATION',
  'REGION',
  'BRANCH',
  'BUILDING',
  'COST_CENTER',
  'ASSET',
  'METER'
] as const;

/**
 * Si el segmento es un UUID (con o sin guiones), lo normaliza al formato con guiones
 * en posiciones estándar. Garantiza paridad entre `custom:tenant_id` (puede llegar
 * sin guiones) y la PK persistida.
 */
function canonicalizeUuidLikeSegment(s: string): string {
  const hex = s.replace(/-/g, '');
  if (!/^[0-9A-F]{32}$/.test(hex)) {
    return s;
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Segmentos de PK/SK en MAYÚSCULAS (evita misses en query). */
export function normalizePartitionSegment(raw: string | undefined | null): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
  return canonicalizeUuidLikeSegment(s);
}

/**
 * Normaliza un identificador de organización: si llega como SK
 * (`TENANT#…#ORG#X`), retorna sólo el último segmento ya canonicalizado.
 */
export function normalizeOrgScopeSegment(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let seg: string;
  if (s.includes('#')) {
    const parts = s.split('#').filter(Boolean);
    const last = parts[parts.length - 1];
    seg = last ? last.trim() : '';
  } else {
    seg = s;
  }
  return normalizePartitionSegment(seg);
}

/**
 * Construye la PK DynamoDB que comparten todos los nodos de una organización
 * dentro de un tenant. Devuelve `''` si alguno de los segmentos es inválido,
 * dejando que la capa de aplicación trate el error.
 */
export function buildTenantOrgPartitionKey(
  tenantId: string | undefined | null,
  organizationScopeId: string | undefined | null
): string {
  const t = normalizePartitionSegment(tenantId);
  const o = normalizeOrgScopeSegment(organizationScopeId);
  if (!t || !o) return '';
  return `TENANT#${t}#ORG#${o}`;
}

/**
 * Devuelve el SK del padre (`REGION#abc`). Si el cliente envía un puntero
 * largo (`TENANT#…#REGION#abc`), recorta a partir del primer prefijo conocido.
 */
export function normalizeParentIdPointer(parentId: string | undefined | null): string {
  if (parentId == null) return 'ROOT';
  const s = String(parentId).trim();
  if (s === '' || s === 'ROOT') return 'ROOT';

  for (const t of NODE_TYPE_PREFIXES) {
    const idx = s.indexOf(`${t}#`);
    if (idx >= 0) {
      return s.slice(idx);
    }
  }

  return s;
}

/**
 * Si el cliente envía el SK de un nodo raíz (`ORGANIZATION#<nodeId>`), extrae
 * `<nodeId>` para inferir el segmento ORG de la PK. Útil cuando el resolver
 * recibe `rootNodeId` o `id` sin claims/`orgId` explícitos.
 */
export function inferOrganizationScopeFromNodeSk(
  skLike: string | undefined | null
): string {
  const s = String(skLike ?? '').trim();
  const m = /^ORGANIZATION#(.+)$/i.exec(s);
  if (!m) return '';
  return normalizePartitionSegment(m[1].trim());
}
