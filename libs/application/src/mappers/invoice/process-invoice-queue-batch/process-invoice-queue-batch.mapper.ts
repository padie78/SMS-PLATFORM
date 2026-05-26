import { extractInvoiceMetadataFromS3Key } from '@sms/domain';

import type { ProcessInvoicePipelineInputDto } from '../../../dtos/invoice/process-invoice-pipeline/process-invoice-pipeline.dto.js';
import type {
  ParsedQueueRecord,
  ProcessInvoiceQueueBatchInputDto,
  SqsBatchRecord
} from '../../../dtos/invoice/process-invoice-queue-batch/process-invoice-queue-batch.dto.js';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Mapper puro: traduce records SQS crudos a `ProcessInvoicePipelineInputDto`.
 *
 * Toleramos:
 *  - Body que no es JSON válido → record skipped.
 *  - Faltantes de `sk` → se intenta derivar desde la S3 key.
 *  - `orgId` ausente → se aplica el `defaultOrgId` del input.
 */
export class ProcessInvoiceQueueBatchMapper {
  static parseRecords(input: ProcessInvoiceQueueBatchInputDto): ReadonlyArray<ParsedQueueRecord> {
    return input.records.map((record) =>
      ProcessInvoiceQueueBatchMapper.parseSingleRecord(record, input.defaultOrgId)
    );
  }

  private static parseSingleRecord(
    record: SqsBatchRecord,
    defaultOrgId: string
  ): ParsedQueueRecord {
    const body = ProcessInvoiceQueueBatchMapper.tryParseJson(record.body);
    if (body === null) {
      return {
        messageId: record.messageId,
        pipelineInput: null,
        skipReason: 'Invalid JSON body'
      };
    }

    const bucket = isNonEmptyString(body.bucket) ? body.bucket : null;
    const key = isNonEmptyString(body.key) ? body.key : null;
    if (!bucket || !key) {
      return {
        messageId: record.messageId,
        pipelineInput: null,
        skipReason: 'Missing bucket or key'
      };
    }

    const orgId = isNonEmptyString(body.orgId) ? body.orgId : defaultOrgId;
    if (!isNonEmptyString(orgId)) {
      return {
        messageId: record.messageId,
        pipelineInput: null,
        skipReason: 'Missing orgId and no defaultOrgId provided'
      };
    }

    const tenantId = isNonEmptyString(body.tenantId) ? body.tenantId : null;
    if (!tenantId) {
      return {
        messageId: record.messageId,
        pipelineInput: null,
        skipReason: 'Missing tenantId in SQS body'
      };
    }

    const sk = ProcessInvoiceQueueBatchMapper.resolveSk(body, key);
    if (!sk) {
      return {
        messageId: record.messageId,
        pipelineInput: null,
        skipReason: 'Could not resolve invoice SK from body or S3 key'
      };
    }

    const invoiceId = isNonEmptyString(body.invoiceId)
      ? body.invoiceId
      : sk.replace(/^INV#/, '');
    const correlationId = isNonEmptyString(body.correlationId) ? body.correlationId : record.messageId;

    const pipelineInput: ProcessInvoicePipelineInputDto = {
      bucket,
      key,
      sk,
      orgId,
      tenantId,
      invoiceId,
      correlationId
    };
    return { messageId: record.messageId, pipelineInput };
  }

  private static tryParseJson(body: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private static resolveSk(body: Record<string, unknown>, key: string): string | null {
    if (isNonEmptyString(body.sk)) {
      return body.sk;
    }
    try {
      const decoded = extractInvoiceMetadataFromS3Key(key);
      return decoded.invoiceSk;
    } catch {
      return null;
    }
  }
}
