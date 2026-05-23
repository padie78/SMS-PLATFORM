import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  IInvoiceGoldenRecordRepository,
  InvoiceGoldenRecord
} from '@sms/application';

export type DynamoInvoiceGoldenRecordRepositoryOptions = {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
};

const ORG_PREFIX = 'ORG#';

/**
 * Adapter DynamoDB: persiste el Golden Record vía TransactWrite con
 * `attribute_exists(PK)` para garantizar que sólo se actualicen skeletons
 * ya creados por el dispatcher.
 */
export class DynamoInvoiceGoldenRecordRepository implements IInvoiceGoldenRecordRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoInvoiceGoldenRecordRepositoryOptions) {
    this.doc = options.doc;
    this.tableName = options.tableName;
  }

  async persistGoldenRecord(record: InvoiceGoldenRecord): Promise<void> {
    const isoNow = new Date().toISOString();
    const finalPK = record.PK.replace(ORG_PREFIX, '');

    await this.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: finalPK, SK: record.SK },
              UpdateExpression:
                'SET #st = :status, ai_analysis = :ai, climatiq_result = :cr, ' +
                'extracted_data = :ed, analytics = :an, processed_at = :now, ' +
                'updated_at = :now, metadata = :meta',
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: {
                ':status': record.status || 'READY_FOR_REVIEW',
                ':ai': record.ai_analysis,
                ':cr': record.climatiq_result,
                ':ed': record.extracted_data,
                ':an': record.analytics,
                ':now': isoNow,
                ':meta': {
                  ...record.metadata,
                  processed_at: isoNow,
                  is_draft: false
                }
              }
            }
          }
        ]
      })
    );
  }
}
