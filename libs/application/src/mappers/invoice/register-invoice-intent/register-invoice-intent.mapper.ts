import { Invoice, InvoiceStatus } from '@sms/domain';

import type { RegisterInvoiceIntentDto } from '../../../dtos/invoice/register-invoice-intent/register-invoice-intent.dto.js';

/** Mapper DTO -> agregado Invoice en estado inicial de procesamiento. */
export class RegisterInvoiceIntentMapper {
  static toDomain(dto: RegisterInvoiceIntentDto): Invoice {
    return new Invoice({
      id: dto.invoiceId,
      meterId: dto.meterId,
      s3Bucket: dto.s3Bucket,
      s3Key: dto.s3Key,
      uploadedBy: dto.uploadedBy,
      status: InvoiceStatus.PENDING_PROCESSING
    });
  }
}
