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
                'SET ai_analysis = :ai, analytics_dimensions = :ad, climatiq_result = :cr, ' +
                'extracted_data = :ed, processed_at = :now, metadata = :meta, ' +
                'total_days_prorated = :days',
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeValues: {
                ':ai': record.ai_analysis,
                ':ad': record.analytics_dimensions,
                ':cr': record.climatiq_result,
                ':ed': record.extracted_data,
                ':now': isoNow,
                ':meta': {
                  ...record.metadata,
                  processed_at: isoNow
                },
                ':days': record.total_days_prorated
              }
            }
          }
        ]
      })
    );
  }
}
