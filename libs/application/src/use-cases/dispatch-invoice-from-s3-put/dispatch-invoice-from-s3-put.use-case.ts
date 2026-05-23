import { Result, type Result as ResultType } from '@sms/common';
import { EnqueuedInvoiceDispatch } from '@sms/domain';

import type { InvoiceDispatchOrgResolverPort } from '../../ports/invoice-dispatch-org-resolver.port.js';
import type { InvoiceDispatchQueuePort } from '../../ports/invoice-dispatch-queue.port.js';
import type { InvoiceDispatchSkeletonWriterPort } from '../../ports/invoice-dispatch-skeleton-writer.port.js';
import type { DispatchInvoiceFromS3PutInputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.input.dto.js';
import type { DispatchInvoiceFromS3PutOutputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.output.dto.js';
import { DispatchInvoiceFromS3PutMapper } from '../../mappers/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.mapper.js';

export type DispatchInvoiceFromS3PutDeps = {
  readonly orgResolver: InvoiceDispatchOrgResolverPort;
  readonly skeletonWriter: InvoiceDispatchSkeletonWriterPort;
  readonly invoiceQueue: InvoiceDispatchQueuePort;
};

/**
 * Caso de uso: S3 PUT de factura → skeleton DynamoDB + mensaje SQS al worker.
 */
export class DispatchInvoiceFromS3PutUseCase {
  constructor(private readonly deps: DispatchInvoiceFromS3PutDeps) {}

  async execute(
    input: DispatchInvoiceFromS3PutInputDto
  ): Promise<ResultType<DispatchInvoiceFromS3PutOutputDto, string>> {
    try {
      const received = DispatchInvoiceFromS3PutMapper.toDomain(input);
      const { requestId, bucket, uploadKey } = received;

      const orgId = await this.deps.orgResolver.resolveOrgId({
        bucket,
        key: uploadKey.objectKey,
        requestId
      });

      await this.deps.skeletonWriter.putInvoiceSkeleton({
        orgId,
        sk: uploadKey.invoiceSk,
        bucket,
        key: uploadKey.objectKey,
        requestId
      });

      await this.deps.invoiceQueue.enqueueInvoice({
        bucket,
        key: uploadKey.objectKey,
        orgId,
        sk: uploadKey.invoiceSk,
        requestId
      });

      const enqueued = EnqueuedInvoiceDispatch.create(uploadKey, orgId);
      return Result.ok(DispatchInvoiceFromS3PutMapper.toOutputDto(enqueued));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown dispatch error';
      return Result.fail(message);
    }
  }
}
