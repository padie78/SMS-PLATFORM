import type { IInvoiceExtractorService } from '../../../ports/IInvoiceExtractorService.js';
import type { IInvoiceRepository } from '../../../ports/IInvoiceRepository.js';
import { InvoiceNotFoundError } from '../errors/InvoiceNotFoundError.js';
import { InvoiceNotProcessableError } from '../errors/InvoiceNotProcessableError.js';
import type { ProcessInvoiceDto } from './dtos/process-invoice.dto.js';

/**
 * Caso de uso: procesa una factura encolada y persiste los datos sugeridos.
 *
 * Si la extracción falla, la entidad se marca como FAILED antes de relanzar el
 * error para que la infraestructura serverless aplique retries o DLQ.
 */
export class ProcessInvoiceUseCase {
  constructor(
    private readonly invoiceRepository: IInvoiceRepository,
    private readonly extractorService: IInvoiceExtractorService
  ) {}

  async execute(dto: ProcessInvoiceDto): Promise<void> {
    const invoice = await this.invoiceRepository.findById(dto.invoiceId);
    if (invoice === null) {
      throw new InvoiceNotFoundError(dto.invoiceId);
    }

    if (!invoice.canBeProcessed()) {
      throw new InvoiceNotProcessableError(dto.invoiceId);
    }

    try {
      const extractedData = await this.extractorService.extract(dto.s3Bucket, dto.s3Key);
      invoice.suggestData(extractedData);
      await this.invoiceRepository.save(invoice);
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Unknown extraction failure';
      invoice.markAsFailed(failureReason);
      await this.invoiceRepository.save(invoice);
      throw error;
    }
  }
}
