/**
 * Composition root: API Lambda (AppSync resolver — node config + invoice lifecycle v2).
 *
 * Resolvers:
 *  - Node: saveNode, updateNode, deleteNode, getNode, getTree, getInvoice (stub)
 *  - Invoice v2: createInvoiceDraft, confirmInvoiceExtraction, rejectInvoice,
 *    retryInvoiceProcessing, getInvoiceLifecycle
 *
 * Variables de entorno:
 *  - DYNAMO_TABLE / DATABASE_NAME (obligatoria)
 *  - SQS_QUEUE_URL (retryInvoiceProcessing → re-enqueue worker)
 *  - DEFAULT_ORGAN_SCOPE_ID, ALLOW_TENANT_FALLBACK_FROM_SUB, ALLOW_TENANT_AS_ORG_FALLBACK (dev)
 */
import {
  createAppSyncApiCombinedHandler,
  createDynamoDocumentClient
} from '@sms/infrastructure';

const tableName = process.env.DYNAMO_TABLE || process.env.DATABASE_NAME;
if (!tableName) {
  throw new Error(
    'api_lambda misconfigured: DYNAMO_TABLE (o DATABASE_NAME) es obligatorio.'
  );
}

const doc = createDynamoDocumentClient();

export const handler = createAppSyncApiCombinedHandler({
  doc,
  tableName,
  sqsQueueUrl: process.env.SQS_QUEUE_URL
});
