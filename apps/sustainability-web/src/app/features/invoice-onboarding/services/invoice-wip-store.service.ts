import { Injectable, signal } from '@angular/core';
import type { EnergyServiceType } from '@sms/common';
import {
  emptyHierarchy,
  type InvoiceHierarchySelection
} from '../../../core/models/invoice-assignment.model';
import type { MeterAllocationRow } from '../../../core/models/invoice-onboarding.model';
import type { InvoiceReviewView } from '../../../core/models/invoice-review.model';
import {
  INVOICE_WIP_SESSION_KEY,
  type InvoiceWipSnapshot
} from '../models/invoice-wip.model';

@Injectable({ providedIn: 'root' })
export class InvoiceWipStoreService {
  private readonly snapshotSignal = signal<InvoiceWipSnapshot | null>(null);

  readonly snapshot = this.snapshotSignal.asReadonly();

  loadFromSession(): InvoiceWipSnapshot | null {
    try {
      const raw = sessionStorage.getItem(INVOICE_WIP_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as InvoiceWipSnapshot;
      this.snapshotSignal.set(parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  clear(): void {
    sessionStorage.removeItem(INVOICE_WIP_SESSION_KEY);
    this.snapshotSignal.set(null);
  }

  initDraft(args: {
    invoiceId: string;
    dynamoInvoiceId: string;
    storageKey: string | null;
    metaVersion: number;
    isOcr: boolean;
  }): InvoiceWipSnapshot {
    const snap: InvoiceWipSnapshot = {
      invoiceId: args.invoiceId,
      dynamoInvoiceId: args.dynamoInvoiceId,
      storageKey: args.storageKey,
      metaVersion: args.metaVersion,
      extractionDraftVersion: null,
      isOcr: args.isOcr,
      extractedData: null,
      hierarchy: emptyHierarchy(),
      energyType: 'ELECTRICITY',
      vendorTaxId: '',
      internalNote: '',
      meterRows: [],
      updatedAt: new Date().toISOString()
    };
    this.persist(snap);
    return snap;
  }

  patch(partial: Partial<InvoiceWipSnapshot>): InvoiceWipSnapshot | null {
    const current = this.snapshotSignal();
    if (!current) return null;
    const next: InvoiceWipSnapshot = {
      ...current,
      ...partial,
      hierarchy: partial.hierarchy
        ? { ...current.hierarchy, ...partial.hierarchy }
        : current.hierarchy,
      updatedAt: new Date().toISOString()
    };
    this.persist(next);
    return next;
  }

  patchExtracted(data: InvoiceReviewView): void {
    this.patch({ extractedData: data });
  }

  patchHierarchy(partial: Partial<InvoiceHierarchySelection>): void {
    const current = this.snapshotSignal();
    if (!current) return;
    this.patch({ hierarchy: { ...current.hierarchy, ...partial } });
  }

  setMetaVersion(version: number): void {
    this.patch({ metaVersion: version });
  }

  setExtractionDraftVersion(version: number | null): void {
    this.patch({ extractionDraftVersion: version });
  }

  setEnergyType(energyType: EnergyServiceType): void {
    this.patch({ energyType });
  }

  setVendorTaxId(vendorTaxId: string): void {
    this.patch({ vendorTaxId });
  }

  setMeterRows(rows: MeterAllocationRow[]): void {
    this.patch({ meterRows: rows });
  }

  getSnapshot(): InvoiceWipSnapshot | null {
    return this.snapshotSignal();
  }

  private persist(snap: InvoiceWipSnapshot): void {
    this.snapshotSignal.set(snap);
    sessionStorage.setItem(INVOICE_WIP_SESSION_KEY, JSON.stringify(snap));
  }
}
