import type { EnergyServiceType } from '@sms/common';
import type { InvoiceHierarchySelection } from '../../../core/models/invoice-assignment.model';
import type { MeterAllocationRow } from '../../../core/models/invoice-onboarding.model';
import type { InvoiceReviewView } from '../../../core/models/invoice-review.model';

/** Snapshot persistido en sessionStorage mientras el usuario avanza el stepper. */
export interface InvoiceWipSnapshot {
  readonly invoiceId: string;
  readonly dynamoInvoiceId: string;
  readonly storageKey: string | null;
  readonly metaVersion: number | null;
  readonly extractionDraftVersion: number | null;
  readonly isOcr: boolean;
  readonly extractedData: InvoiceReviewView | null;
  readonly hierarchy: InvoiceHierarchySelection;
  readonly energyType: EnergyServiceType;
  readonly vendorTaxId: string;
  readonly internalNote: string;
  readonly meterRows: MeterAllocationRow[];
  readonly updatedAt: string;
}

export const INVOICE_WIP_SESSION_KEY = 'sms-invoice-wip-v1';
