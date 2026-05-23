/**
 * Parser de eventos AppSync (Lambda direct + Mapping Template).
 *
 * Vive en infraestructura porque depende del shape concreto del evento
 * (`event.identity`, `event.info.fieldName`) y consume variables de entorno
 * para resolver fallback de tenant. La capa de aplicación solo recibe el
 * `PartitionContext` ya resuelto.
 */
import type { PartitionContext } from '@sms/application';
import { ApplicationValidationError } from '@sms/application';
import {
  inferOrganizationScopeFromNodeSk,
  normalizeOrgScopeSegment,
  normalizePartitionSegment
} from '@sms/domain';

export interface AppSyncLambdaEvent {
  readonly arguments?: Record<string, unknown>;
  readonly identity?: AppSyncIdentity;
  readonly info?: AppSyncInfo;
  readonly fieldName?: string;
  readonly methodName?: string;
  readonly prev?: unknown;
  readonly stash?: unknown;
  readonly requestContext?: { readonly requestId?: string };
  readonly holdingId?: string;
}

export interface AppSyncIdentity {
  readonly sub?: string;
  readonly username?: string;
  readonly claims?: Record<string, unknown>;
}

export interface AppSyncInfo {
  readonly fieldName?: string;
  readonly parentTypeName?: string;
}

/**
 * AppSync invoca al lambda con el contexto completo o sólo con el JSON
 * generado por el mapping template (`holdingId`, `arguments`, `identity`,
 * `info`). Esta función rellena `info` cuando falta para garantizar que el
 * resto del pipeline pueda asumir su presencia.
 */
export function normalizeAppSyncLambdaEvent<T extends AppSyncLambdaEvent>(raw: T): T {
  if (raw == null) return raw;
  const r = raw as AppSyncLambdaEvent;
  const hasEnvelope =
    typeof r === 'object' &&
    typeof r.arguments === 'object' &&
    typeof r.identity === 'object' &&
    r.info !== undefined;

  const hasClassicFieldName =
    r.info?.fieldName != null || typeof r.fieldName === 'string';

  if (hasEnvelope && hasClassicFieldName) {
    return raw;
  }

  if (hasEnvelope) {
    return {
      ...raw,
      arguments: r.arguments ?? {},
      info: r.info ?? { fieldName: 'unknown', parentTypeName: 'Mutation' }
    };
  }

  return raw;
}

/** Aplana `claims` y `sub`/`username` en un único objeto. */
function buildEffectiveClaims(event: AppSyncLambdaEvent | undefined): Record<string, unknown> {
  const identity = event?.identity;
  if (!identity || typeof identity !== 'object') {
    return {};
  }

  const base: Record<string, unknown> =
    identity.claims && typeof identity.claims === 'object' && !Array.isArray(identity.claims)
      ? { ...identity.claims }
      : {};

  if (typeof identity.sub === 'string' && identity.sub.trim()) {
    if (base.sub == null || String(base.sub).trim() === '') {
      base.sub = identity.sub.trim();
    }
  }

  if (typeof identity.username === 'string' && identity.username.trim()) {
    if (base['cognito:username'] == null || String(base['cognito:username']).trim() === '') {
      base['cognito:username'] = identity.username.trim();
    }
  }

  return base;
}

function pickClaim(claims: Record<string, unknown>, key: string): string {
  const v = claims[key];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function envOrganizationScopeFallback(): string {
  return (process.env.DEFAULT_ORGAN_SCOPE_ID ?? '').trim();
}

/**
 * Resuelve el `PartitionContext` final aplicando la prioridad:
 *   `args.input.orgId` → `args.orgId` → claims → `rootNodeId`/`id` SK → env.
 *
 * @throws {ApplicationValidationError} si no es posible obtener `tenantId`.
 */
export function resolvePartitionContextFromEvent(
  event: AppSyncLambdaEvent
): PartitionContext {
  const claims = buildEffectiveClaims(event);

  let tenantId = pickClaim(claims, 'custom:tenant_id');

  if (!tenantId) {
    const envDefault = (
      process.env.LAMBDA_DEFAULT_TENANT_ID ||
      process.env.DEV_TENANT_ID ||
      ''
    ).trim();
    if (envDefault) {
      console.warn(
        '[MULTI_TENANT] custom:tenant_id ausente; usando LAMBDA_DEFAULT_TENANT_ID / DEV_TENANT_ID (solo desarrollo).'
      );
      tenantId = envDefault;
    } else if (process.env.ALLOW_ANON_TENANT_FALLBACK === 'true') {
      const fb = (process.env.DEV_TENANT_ID ?? '').trim();
      if (fb) {
        tenantId = fb;
      }
    } else if (process.env.ALLOW_TENANT_FALLBACK_FROM_SUB === 'true') {
      tenantId = pickClaim(claims, 'sub');
      if (tenantId) {
        console.warn(
          '[MULTI_TENANT] ALLOW_TENANT_FALLBACK_FROM_SUB: usando `sub` como tenantId (configurá custom:tenant_id en Cognito para producción).'
        );
      }
    }
  }

  if (!tenantId) {
    throw new ApplicationValidationError(
      'Aislamiento: falta el claim custom:tenant_id en el Id Token. Opciones: (1) Definir el atributo en Cognito y asignarlo al usuario, ' +
        '(2) Variables LAMBDA_DEFAULT_TENANT_ID o DEV_TENANT_ID en la Lambda, ' +
        '(3) En desarrollo: ALLOW_TENANT_FALLBACK_FROM_SUB=true para usar el sub de Cognito como tenant provisional.'
    );
  }

  const organizationId = pickClaim(claims, 'custom:organization_id');
  const holdingId = pickClaim(claims, 'custom:holding_id');
  const rawOrgScope = organizationId || holdingId || envOrganizationScopeFallback();

  return {
    tenantId: normalizePartitionSegment(tenantId),
    organizationScopeId: rawOrgScope ? normalizeOrgScopeSegment(rawOrgScope) : ''
  };
}

/**
 * Combina el contexto base con datos provenientes de los args GraphQL del
 * resolver actual (puede sobreescribir `organizationScopeId`).
 */
export function mergePartitionContextFromGraphQLArgs(
  baseCtx: PartitionContext,
  args: Record<string, unknown> | null | undefined
): PartitionContext {
  const inp = args?.input;
  const fromInput =
    inp != null && typeof inp === 'object'
      ? String(
          (inp as Record<string, unknown>).orgId ??
            (inp as Record<string, unknown>).organizationId ??
            ''
        ).trim()
      : '';
  const fromRoot = String(args?.orgId ?? args?.organizationId ?? '').trim();
  const fromSkHint =
    inferOrganizationScopeFromNodeSk(args?.rootNodeId as string | undefined) ||
    inferOrganizationScopeFromNodeSk(args?.id as string | undefined);

  const mergedOrg =
    fromInput ||
    fromRoot ||
    String(baseCtx.organizationScopeId ?? '').trim() ||
    fromSkHint ||
    envOrganizationScopeFallback();

  const organizationScopeId = mergedOrg ? normalizeOrgScopeSegment(mergedOrg) : '';
  return { ...baseCtx, organizationScopeId };
}
