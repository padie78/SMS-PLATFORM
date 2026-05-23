/**
 * Composition root: API Lambda (AppSync resolver — configuración multi-tenant).
 *
 * Resolvers expuestos: `saveNode`, `updateNode`, `deleteNode`, `getNode`,
 * `getTree`, `getInvoice` (stub). La lógica vive en `@sms/application`
 * (`HandleAppSyncRequestUseCase`) y `@sms/infrastructure`
 * (`DynamoNodeConfigRepository`, `appsync-event.parser`).
 *
 * Variables de entorno relevantes:
 *  - DYNAMO_TABLE / DATABASE_NAME : tabla single-table (obligatoria).
 *  - DEFAULT_ORGAN_SCOPE_ID       : org fallback cuando no hay claims.
 *  - LAMBDA_DEFAULT_TENANT_ID / DEV_TENANT_ID / ALLOW_TENANT_FALLBACK_FROM_SUB
 *                                  : modo desarrollo (NO PROD).
 */
import {
  createAppSyncNodeConfigHandler,
  createDynamoDocumentClient
} from "@sms/infrastructure";

const tableName =
  process.env.DYNAMO_TABLE ||
  process.env.DATABASE_NAME ||
  "sms-platform-dev-emissions";

const doc = createDynamoDocumentClient();

export const handler = createAppSyncNodeConfigHandler({
  doc,
  tableName
});
