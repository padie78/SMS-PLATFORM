import { createDynamoDocumentClient, createProcessInvoiceQueueBatchUseCase } from '@sms/infrastructure';

// --- COMPOSITION ROOT (config/) ---
const tableName = process.env.DYNAMO_TABLE ?? process.env.DYNAMODB_TABLE;
if (!tableName) {
  throw new Error('DYNAMO_TABLE environment variable is not defined');
}

const defaultOrgId = process.env.DEFAULT_ORG_ID ?? 'DEFAULT_ORG';
const appsyncUrl = process.env.APPSYNC_URL;
const appsyncApiKey = process.env.APPSYNC_API_KEY;
const appsyncUrlSsmParameter = process.env.APPSYNC_URL_SSM_PARAMETER;
const appsyncApiKeySsmParameter = process.env.APPSYNC_API_KEY_SSM_PARAMETER;

const doc = createDynamoDocumentClient();
const processInvoiceQueueBatch = createProcessInvoiceQueueBatchUseCase({
  doc,
  tableName,
  appsyncUrl,
  appsyncApiKey,
  appsyncUrlSsmParameter,
  appsyncApiKeySsmParameter
});

// --- HANDLER (traductor AWS → caso de uso) ---
export const handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : [];

  const input = {
    records: records.map((record) => ({
      messageId: String(record?.messageId ?? ''),
      body: typeof record?.body === 'string' ? record.body : ''
    })),
    defaultOrgId
  };

  const result = await processInvoiceQueueBatch.execute(input);

  return { batchItemFailures: result.batchItemFailures };
};
