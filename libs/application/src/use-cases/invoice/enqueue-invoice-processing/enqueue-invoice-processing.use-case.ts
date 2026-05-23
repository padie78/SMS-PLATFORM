import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type {
  IInvoiceProcessingQueueWriter,
  InvoiceProcessingQueueMessage
} from '../../../ports/IInvoiceProcessingQueueWriter.js';
import type {
  EnqueueInvoiceProcessingInputDto,
  EnqueueInvoiceProcessingOutputDto
} from './dtos/enqueue-invoice-processing.dto.js';

export type EnqueueInvoiceProcessingDeps = {
  readonly queue: IInvoiceProcessingQueueWriter;
  /**
   * Inyectable para testing. En producción se usa `() => new Date().toISOString()`.
   * El caso de uso no debe llamar a `Date.now()` directamente para mantenerse puro.
   */
  readonly clock?: () => string;
};

/**
 * Caso de uso puro: encola un mensaje de procesamiento de factura.
 *
 * Esta es la pieza "thin" — su única responsabilidad es validar el DTO,
 * armar el `InvoiceProcessingQueueMessage` canónico y delegar en el puerto.
 *
 * NO hace:
 *  - Lectura/escritura en DynamoDB (eso lo hace `RegisterInvoiceIntentUseCase`).
 *  - Resolución de tenant/org desde claims (eso lo hace el primary adapter).
 *
 * Sí hace:
 *  - Validación de invariantes mínimas (campos no vacíos).
 *  - Marca temporal monotónica del lado emisor.
 */
export class EnqueueInvoiceProcessingUseCase {
  private readonly clock: () => string;

  constructor(private readonly deps: EnqueueInvoiceProcessingDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  async execute(
    dto: EnqueueInvoiceProcessingInputDto
  ): Promise<EnqueueInvoiceProcessingOutputDto> {
    this.assertNonEmpty(dto.invoiceId, 'invoiceId', dto.requestId);
    this.assertNonEmpty(dto.tenantId, 'tenantId', dto.requestId);
    this.assertNonEmpty(dto.orgId, 'orgId', dto.requestId);
    this.assertNonEmpty(dto.s3Bucket, 's3Bucket', dto.requestId);
    this.assertNonEmpty(dto.s3Key, 's3Key', dto.requestId);

    const enqueuedAt = this.clock();

    const message: InvoiceProcessingQueueMessage = {
      invoiceId: dto.invoiceId,
      tenantId: dto.tenantId,
      orgId: dto.orgId,
      s3Bucket: dto.s3Bucket,
      s3Key: dto.s3Key,
      enqueuedAt,
      ...(dto.metadata ? { metadata: dto.metadata } : {})
    };

    await this.deps.queue.enqueue(message);

    return { invoiceId: dto.invoiceId, enqueuedAt };
  }

  private assertNonEmpty(value: string, field: string, requestId: string): void {
    if (!value || !String(value).trim()) {
      throw new ApplicationValidationError(
        `EnqueueInvoiceProcessing: '${field}' is required (requestId=${requestId})`
      );
    }
  }
}
