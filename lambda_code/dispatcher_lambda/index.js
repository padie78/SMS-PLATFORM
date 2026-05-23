/**
 * Thin entrypoint: Dispatcher Lambda (S3 PUT → skeleton DynamoDB + SQS).
 *
 * Este archivo no instancia casos de uso ni parsea eventos. Sólo exporta el
 * primary adapter construido por `@sms/infrastructure`, que internamente
 * traduce el evento S3 al DTO plano y delega en `@sms/application`.
 */
import { createDynamoDocumentClient, createDispatchInvoiceFromS3PutHandler } from '@sms/infrastructure';

const queueUrl = process.env.SQS_QUEUE_URL;
if (!queueUrl) {
  throw new Error('SQS_QUEUE_URL environment variable is not defined');
}

const tableName = process.env.DYNAMO_TABLE ?? process.env.DYNAMODB_TABLE;
if (!tableName) {
  throw new Error('DYNAMO_TABLE environment variable is not defined');
}

const doc = createDynamoDocumentClient();

export const handler = createDispatchInvoiceFromS3PutHandler({
  doc,
  tableName,
  queueUrl
});
