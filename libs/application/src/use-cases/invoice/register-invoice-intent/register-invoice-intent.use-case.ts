import type { IInvoiceRepository } from '../../../ports/invoice-repository.port.js';
import type { IQueueService } from '../../../ports/queue-service.port.js';
import { InvoiceAlreadyExistsError } from '../errors/InvoiceAlreadyExistsError.js';
import type { RegisterInvoiceIntentDto } from '../../../dtos/invoice/register-invoice-intent/register-invoice-intent.dto.js';
import { RegisterInvoiceIntentMapper } from '../../../mappers/invoice/register-invoice-intent/register-invoice-intent.mapper.js';

/**
 * Caso de uso: registra el skeleton auditable de una factura y encola su ingesta.
 */
export class RegisterInvoiceIntentUseCase {
  constructor(
    private readonly invoiceRepository: IInvoiceRepository,
    private readonly queueService: IQueueService
  ) {}

  async execute(dto: RegisterInvoiceIntentDto): Promise<void> {
    const existing = await this.invoiceRepository.findById(dto.invoiceId);
    if (existing !== null) {
      throw new InvoiceAlreadyExistsError(dto.invoiceId);
    }

    const skeleton = RegisterInvoiceIntentMapper.toDomain(dto);
    await this.invoiceRepository.save(skeleton);

    await this.queueService.sendMessage({
      invoiceId: dto.invoiceId,
      s3Bucket: dto.s3Bucket,
      s3Key: dto.s3Key
    });
  }
}
