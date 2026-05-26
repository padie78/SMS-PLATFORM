import { Result, type Result as ResultType } from '@sms/common';
import { EnqueuedInvoiceDispatch } from '@sms/domain';

import type { InvoiceDispatchLifecyclePort } from '../../ports/invoice-dispatch-lifecycle.port.js';
import type { InvoiceDispatchQueuePort } from '../../ports/invoice-dispatch-queue.port.js';
import type { DispatchInvoiceFromS3PutInputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.input.dto.js';
import type { DispatchInvoiceFromS3PutOutputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.output.dto.js';
import { DispatchInvoiceFromS3PutMapper } from '../../mappers/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.mapper.js';

export type DispatchInvoiceFromS3PutDeps = {
  readonly lifecycle: InvoiceDispatchLifecyclePort;
  readonly invoiceQueue: InvoiceDispatchQueuePort;
};

/**
 * Caso de uso: S3 PUT de factura → lifecycle v2 (UPLOADED→DISPATCHED) + SQS.
 */
export class DispatchInvoiceFromS3PutUseCase {
  constructor(private readonly deps: DispatchInvoiceFromS3PutDeps) {}

  async execute(
    input: DispatchInvoiceFromS3PutInputDto
  ): Promise<ResultType<DispatchInvoiceFromS3PutOutputDto, string>> {
    try {
      const received = DispatchInvoiceFromS3PutMapper.toDomain(input);
      const { requestId, bucket, uploadKey } = received;

      const lifecycle = await this.deps.lifecycle.onInvoiceUploaded({
        invoiceSk: uploadKey.invoiceSk,
        bucket,
        key: uploadKey.objectKey,
        requestId
      });

      await this.deps.invoiceQueue.enqueueInvoice({
        bucket,
        key: uploadKey.objectKey,
        orgId: lifecycle.orgId,
        tenantId: lifecycle.tenantId,
        invoiceId: lifecycle.invoiceId,
        sk: uploadKey.invoiceSk,
        requestId
      });

      const enqueued = EnqueuedInvoiceDispatch.create(uploadKey, lifecycle.orgId);
      return Result.ok(DispatchInvoiceFromS3PutMapper.toOutputDto(enqueued));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown dispatch error';
      return Result.fail(message);
    }
  }
}
