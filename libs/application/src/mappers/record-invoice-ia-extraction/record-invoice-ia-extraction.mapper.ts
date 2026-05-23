import type { InvoiceIaExtractedPatch, TenantOrgContext } from '@sms/domain';

import type { RecordInvoiceIaExtractionInputDto } from '../../dtos/record-invoice-ia-extraction/record-invoice-ia-extraction.input.dto.js';

export class RecordInvoiceIaExtractionMapper {
  static toTenantOrgContext(dto: RecordInvoiceIaExtractionInputDto): TenantOrgContext {
    return { tenantId: dto.tenantId, orgId: dto.orgId };
  }

  static toPatch(dto: RecordInvoiceIaExtractionInputDto): InvoiceIaExtractedPatch {
    return dto.patch as InvoiceIaExtractedPatch;
  }
}
