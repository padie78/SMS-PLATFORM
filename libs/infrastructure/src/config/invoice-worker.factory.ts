import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  ProcessInvoicePipelineUseCase,
  ProcessInvoiceQueueBatchUseCase,
  type ProcessInvoicePipelineDeps,
  type ProcessInvoiceQueueBatchDeps
} from '@sms/application';

import { AppSyncInvoiceStatusNotifierAdapter } from '../adapters/services/aws/invoice/notifications/appsync-invoice-status-notifier.adapter.js';
import { BedrockInvoiceAiAnalyzerAdapter } from '../adapters/services/aws/invoice/extraction/bedrock-invoice-ai-analyzer.adapter.js';
import { BedrockInvoiceCategoryClassifierAdapter } from '../adapters/services/aws/invoice/extraction/bedrock-invoice-category-classifier.adapter.js';
import { DynamoInvoiceGoldenRecordRepository } from '../adapters/services/aws/invoice/extraction/dynamo-invoice-golden-record.repository.js';
import { TextractInvoiceOcrAdapter } from '../adapters/services/aws/invoice/extraction/textract-invoice-ocr.adapter.js';

export type CreateProcessInvoiceQueueBatchUseCaseParams = {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly appsyncUrl?: string;
  readonly appsyncApiKey?: string;
  readonly textractRegion?: string;
  readonly bedrockRegion?: string;
  readonly classifierRegion?: string;
};

/**
 * Composition root del worker SQS de ingesta de facturas.
 *
 * Cablea los adapters AWS con los use cases puros del @sms/application:
 *  - Textract → IInvoiceOcrService
 *  - Bedrock (clasificación) → IInvoiceCategoryClassifierService
 *  - Bedrock (análisis estructurado) → IInvoiceAiAnalyzerService
 *  - DynamoDB (Golden Record) → IInvoiceGoldenRecordRepository
 *  - AppSync (push UI) → IInvoiceStatusNotifierService
 */
export function createProcessInvoiceQueueBatchUseCase(
  params: CreateProcessInvoiceQueueBatchUseCaseParams
): ProcessInvoiceQueueBatchUseCase {
  const pipelineDeps: ProcessInvoicePipelineDeps = {
    ocrService: new TextractInvoiceOcrAdapter({ region: params.textractRegion }),
    categoryClassifier: new BedrockInvoiceCategoryClassifierAdapter({
      region: params.classifierRegion
    }),
    aiAnalyzer: new BedrockInvoiceAiAnalyzerAdapter({ region: params.bedrockRegion }),
    goldenRecordRepository: new DynamoInvoiceGoldenRecordRepository({
      doc: params.doc,
      tableName: params.tableName
    }),
    statusNotifier: new AppSyncInvoiceStatusNotifierAdapter({
      appsyncUrl: params.appsyncUrl,
      apiKey: params.appsyncApiKey
    })
  };

  const pipeline = new ProcessInvoicePipelineUseCase(pipelineDeps);
  const batchDeps: ProcessInvoiceQueueBatchDeps = { pipeline };
  return new ProcessInvoiceQueueBatchUseCase(batchDeps);
}
