import { DomainInvariantError } from '../../exceptions/domain-invariant.error.js';

export enum InvoiceStatus {
  PENDING_PROCESSING = 'PENDING_PROCESSING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  FAILED = 'FAILED'
}

export interface InvoiceSuggestedData {
  readonly consumptionKwh: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalAmount: number;
}

export interface InvoiceProps {
  readonly id: string;
  readonly meterId: string;
  readonly s3Bucket: string;
  readonly s3Key: string;
  readonly uploadedBy: string;
  readonly status: InvoiceStatus;
  readonly suggestedData?: InvoiceSuggestedData;
  readonly failureReason?: string;
}

/** Agregado de dominio para el flujo de alta e ingesta de facturas. */
export class Invoice {
  private props: InvoiceProps;

  constructor(props: InvoiceProps) {
    this.assertValidIdentity(props);
    this.props = { ...props };
  }

  get id(): string {
    return this.props.id;
  }

  get meterId(): string {
    return this.props.meterId;
  }

  get s3Bucket(): string {
    return this.props.s3Bucket;
  }

  get s3Key(): string {
    return this.props.s3Key;
  }

  get uploadedBy(): string {
    return this.props.uploadedBy;
  }

  get status(): InvoiceStatus {
    return this.props.status;
  }

  get suggestedData(): InvoiceSuggestedData | undefined {
    return this.props.suggestedData === undefined ? undefined : { ...this.props.suggestedData };
  }

  get failureReason(): string | undefined {
    return this.props.failureReason;
  }

  canBeProcessed(): boolean {
    return this.props.status === InvoiceStatus.PENDING_PROCESSING;
  }

  suggestData(data: InvoiceSuggestedData): void {
    if (!this.canBeProcessed()) {
      throw new DomainInvariantError('Invoice cannot receive suggested data in its current state');
    }
    this.assertValidSuggestedData(data);
    this.props = {
      ...this.props,
      suggestedData: { ...data },
      status: InvoiceStatus.PENDING_REVIEW,
      failureReason: undefined
    };
  }

  markAsFailed(reason: string): void {
    const failureReason = reason.trim();
    if (!failureReason) {
      throw new DomainInvariantError('Invoice failure reason is required');
    }
    this.props = {
      ...this.props,
      status: InvoiceStatus.FAILED,
      failureReason
    };
  }

  toPrimitives(): InvoiceProps {
    return {
      ...this.props,
      suggestedData:
        this.props.suggestedData === undefined ? undefined : { ...this.props.suggestedData }
    };
  }

  private assertValidIdentity(props: InvoiceProps): void {
    if (!props.id.trim()) {
      throw new DomainInvariantError('Invoice.id is required');
    }
    if (!props.meterId.trim()) {
      throw new DomainInvariantError('Invoice.meterId is required');
    }
    if (!props.s3Bucket.trim()) {
      throw new DomainInvariantError('Invoice.s3Bucket is required');
    }
    if (!props.s3Key.trim()) {
      throw new DomainInvariantError('Invoice.s3Key is required');
    }
    if (!props.uploadedBy.trim()) {
      throw new DomainInvariantError('Invoice.uploadedBy is required');
    }
  }

  private assertValidSuggestedData(data: InvoiceSuggestedData): void {
    if (data.consumptionKwh < 0) {
      throw new DomainInvariantError('Invoice consumptionKwh cannot be negative');
    }
    if (data.totalAmount < 0) {
      throw new DomainInvariantError('Invoice totalAmount cannot be negative');
    }
    if (!data.periodStart.trim() || !data.periodEnd.trim()) {
      throw new DomainInvariantError('Invoice billing period is required');
    }
    if (new Date(data.periodStart) > new Date(data.periodEnd)) {
      throw new DomainInvariantError('Invoice periodStart cannot be after periodEnd');
    }
  }
}
