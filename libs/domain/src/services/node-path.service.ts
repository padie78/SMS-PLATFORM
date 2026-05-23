import { DomainInvariantError } from '../exceptions/domain-invariant.error.js';

/**
 * Helpers de path enumeration para la jerarquía multi-tenant
 * (delimitador `#`). Root: `#NODE_ID#`. Hijo: `<parentPath>CHILD_ID#`.
 *
 * Estos algoritmos son puros (no tocan AWS) y por tanto viven en el dominio.
 */

export function normalizeSegmentId(segmentId: string | undefined | null): string {
  return String(segmentId ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
}

export function appendSegmentToLocationPath(
  parentFullPath: string | null | undefined,
  segmentId: string
): string {
  const id = normalizeSegmentId(segmentId);
  const base = parentFullPath == null || parentFullPath === '' ? '' : String(parentFullPath);
  const normalizedParent = base.endsWith('#') ? base : `${base}#`;
  if (!normalizedParent || normalizedParent === '#') {
    return `#${id}#`;
  }
  return `${normalizedParent}${id}#`;
}

export function pathStartsWithLocationPrefix(absPath: string, prefix: string): boolean {
  const s = String(absPath ?? '');
  const p = String(prefix ?? '');
  return s.startsWith(p);
}

/**
 * Sustituye un único prefijo inicial en `absPath`. Útil para mover subárboles
 * conservando la coherencia del path enumeration. Lanza un error de dominio si
 * el path no empieza con el prefijo viejo (invariante: no se puede mover algo
 * que no pertenece al subárbol).
 */
export function replaceLocationPathPrefix(
  absPath: string,
  oldPrefix: string,
  newPrefix: string
): string {
  const s = String(absPath ?? '');
  const op = String(oldPrefix ?? '');
  if (!op) return absPath;
  if (!s.startsWith(op)) {
    throw new DomainInvariantError('PATH_PREFIX_MISMATCH_FOR_MOVE');
  }
  return `${newPrefix}${s.slice(op.length)}`;
}

export const LOCATION_NODE_ENTITY = {
  BRANCH: 'BRANCH',
  BUILDING: 'BUILDING',
  METER: 'METER'
} as const;

export type LocationNodeEntityType =
  (typeof LOCATION_NODE_ENTITY)[keyof typeof LOCATION_NODE_ENTITY];

export function stableLocationNodeSk(type: LocationNodeEntityType, id: string): string {
  const t = normalizeSegmentId(type);
  const i = normalizeSegmentId(id);
  return `NODE#${t}#${i}`;
}

export function legacyBuildingSk(branchId: string, buildingId: string): string {
  const bid = normalizeSegmentId(branchId);
  const bnum = normalizeSegmentId(buildingId);
  return `BRANCH#${bid}#BLDG#${bnum}`;
}

export function legacyMeterSk(meterId: string): string {
  return `METER#${normalizeSegmentId(meterId)}`;
}
