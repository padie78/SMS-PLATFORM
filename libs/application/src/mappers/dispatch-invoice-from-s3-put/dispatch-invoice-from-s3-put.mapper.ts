import {
  EnqueuedInvoiceDispatch,
  InvoiceS3PutReceived,
  InvoiceUploadKey
} from '@sms/domain';

import type { DecodedInvoiceUploadKeyDto } from '../../dtos/dispatch-invoice-from-s3-put/decoded-invoice-upload-key.dto.js';
import type { DispatchInvoiceFromS3PutInputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.input.dto.js';
import type { DispatchInvoiceFromS3PutOutputDto } from '../../dtos/dispatch-invoice-from-s3-put/dispatch-invoice-from-s3-put.output.dto.js';
import type { S3DispatcherInvokeDto } from '../../dtos/dispatch-invoice-from-s3-put/s3-dispatcher-invoke.dto.js';

/** Traductor DTO plano ↔ entidades de dominio (sin Zod ni persistencia). */
export class DispatchInvoiceFromS3PutMapper {
  static toInputDto(
    invoke: S3DispatcherInvokeDto,
    decoded: DecodedInvoiceUploadKeyDto
  ): DispatchInvoiceFromS3PutInputDto {
    return {
      requestId: invoke.requestId,
      bucket: invoke.bucket,
      invoiceSk: decoded.invoiceSk,
      objectKey: decoded.objectKey
    };
  }

  static decodedUploadKeyFromDomain(uploadKey: InvoiceUploadKey): DecodedInvoiceUploadKeyDto {
    return {
      invoiceSk: uploadKey.invoiceSk,
      objectKey: uploadKey.objectKey
    };
  }

  static toDomain(input: DispatchInvoiceFromS3PutInputDto): InvoiceS3PutReceived {
    const uploadKey = InvoiceUploadKey.create(input.invoiceSk, input.objectKey);
    return InvoiceS3PutReceived.create(input.requestId, input.bucket, uploadKey);
  }

  static toOutputDto(entity: EnqueuedInvoiceDispatch): DispatchInvoiceFromS3PutOutputDto {
    return {
      status: entity.status,
      invoiceId: entity.uploadKey.invoiceSk,
      orgId: entity.orgId,
      key: entity.uploadKey.objectKey
    };
  }
}
