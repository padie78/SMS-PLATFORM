import { Injectable, computed, inject, signal } from '@angular/core';
import type { EnergyServiceType } from '@sms/common';
import type { InvoiceReviewView } from '../../../core/models/invoice-review.model';
import type { MeterAllocationRow } from '../../../core/models/invoice-onboarding.model';
import { InvoiceStateService } from '../../../services/state/invoice-state.service';
import { WorkflowStateService } from '../../../services/state/workflow-state.service';
import {
  INVOICE_HIERARCHY_BRANCHES,
  INVOICE_HIERARCHY_BUILDINGS
} from '../../../services/business/invoice-hierarchy-catalog';
import { MOCK_HISTORICAL_AVG_KWH, MOCK_METER_ALLOCATION_TEMPLATE } from '../data/invoice-onboarding.mock';
import { InvoiceOnboardingPipelineService } from './invoice-onboarding-pipeline.service';
import { InvoiceWipStoreService } from './invoice-wip-store.service';

const CO2E_FACTOR_KG_PER_KWH = 0.00028;

@Injectable({ providedIn: 'root' })
export class InvoiceOnboardingUiService {
  private readonly invoiceState = inject(InvoiceStateService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly pipeline = inject(InvoiceOnboardingPipelineService);
  private readonly wipStore = inject(InvoiceWipStoreService);

  readonly gatePassed = signal(false);
  readonly isOCR = signal(true);
  readonly ocrSimulating = signal(false);
  readonly ocrProgress = signal(0);
  readonly showSuccess = signal(false);
  readonly successCo2eKg = signal(0);
  readonly isCommitting = signal(false);
  readonly deviationAcknowledged = signal(false);
  readonly meterRows = signal<MeterAllocationRow[]>([]);

  readonly wipWarnings = computed(
    () => this.wipStore.getSnapshot()?.extractionWarnings ?? []
  );
  readonly wipSuspicious = computed(
    () => this.wipStore.getSnapshot()?.extractionSuspicious ?? []
  );

  readonly branchOptions = INVOICE_HIERARCHY_BRANCHES.map((b) => ({
    label: b.label,
    value: b.value
  }));

  readonly historicalAvgKwh = (): number => MOCK_HISTORICAL_AVG_KWH;

  readonly consumptionDeviationPct = computed(() => {
    const inv = this.invoiceState.getSnapshot().extractedData;
    if (!inv?.consumption || inv.consumption <= 0) return 0;
    const avg = MOCK_HISTORICAL_AVG_KWH;
    if (avg <= 0) return 0;
    return (Math.abs(inv.consumption - avg) / avg) * 100;
  });

  readonly hasConsumptionDeviationWarning = computed(
    () => this.consumptionDeviationPct() > 20
  );

  readonly workflowPhase = computed(() => this.workflow.currentPhase());

  selectOcrPath(): void {
    this.isOCR.set(true);
  }

  selectManualPath(): void {
    this.isOCR.set(false);
  }

  passGate(): void {
    this.gatePassed.set(true);
  }

  resetFlow(): void {
    this.pipeline.tearDown();
    this.wipStore.clear();
    this.gatePassed.set(false);
    this.isOCR.set(true);
    this.ocrSimulating.set(false);
    this.ocrProgress.set(0);
    this.showSuccess.set(false);
    this.successCo2eKg.set(0);
    this.isCommitting.set(false);
    this.deviationAcknowledged.set(false);
    this.meterRows.set([]);
  }

  buildingOptionsForBranch(branchId: string) {
    return INVOICE_HIERARCHY_BUILDINGS.filter((b) => b.branchId === branchId).map((b) => ({
      label: b.label,
      value: b.value
    }));
  }

  patchHierarchyFromForm(branchId: string, buildingId: string): void {
    this.invoiceState.patchHierarchy({ branchId, buildingId });
    this.wipStore.patchHierarchy({ branchId, buildingId });
  }

  setEnergyType(energyType: EnergyServiceType): void {
    this.wipStore.setEnergyType(energyType);
  }

  setVendorTaxId(vendorTaxId: string): void {
    this.wipStore.setVendorTaxId(vendorTaxId);
  }

  /** Tras subida: draft DDB + S3 + suscripción IA (sin mocks). */
  async runPostUploadPipeline(file: File): Promise<void> {
    this.ocrSimulating.set(this.isOCR());
    this.ocrProgress.set(8);

    const progressTimer = this.isOCR()
      ? window.setInterval(() => {
          const p = this.ocrProgress();
          if (p < 92) this.ocrProgress.set(Math.min(92, p + 4));
        }, 800)
      : null;

    try {
      await this.pipeline.uploadAndStartPipeline(file, this.isOCR());
      this.ocrProgress.set(100);
    } finally {
      if (progressTimer != null) {
        clearInterval(progressTimer);
      }
      this.ocrSimulating.set(false);
    }
  }

  initMeterRowsFromConsumption(): void {
    const inv = this.invoiceState.getSnapshot().extractedData;
    const total = inv?.consumption ?? 0;
    const n = MOCK_METER_ALLOCATION_TEMPLATE.length;
    const base = n > 0 ? Math.floor(total / n) : 0;
    const remainder = n > 0 ? total - base * n : 0;
    const rows: MeterAllocationRow[] = MOCK_METER_ALLOCATION_TEMPLATE.map((m, i) => ({
      ...m,
      allocatedKwh: base + (i === 0 ? remainder : 0)
    }));
    this.meterRows.set(rows);
    this.wipStore.setMeterRows(rows);
  }

  patchMeterRow(id: string, kwh: number): void {
    this.meterRows.update((rows) => {
      const next = rows.map((r) =>
        r.id === id ? { ...r, allocatedKwh: Math.max(0, kwh) } : r
      );
      this.wipStore.setMeterRows(next);
      return next;
    });
  }

  readonly allocatedTotalKwh = computed(() =>
    this.meterRows().reduce((acc, r) => acc + (Number.isFinite(r.allocatedKwh) ? r.allocatedKwh : 0), 0)
  );

  allocationMatchesInvoice(): boolean {
    const inv = this.invoiceState.getSnapshot().extractedData;
    const target = inv?.consumption ?? 0;
    return Math.abs(this.allocatedTotalKwh() - target) < 0.01;
  }

  computeSuccessCo2FromInvoice(): void {
    const inv = this.invoiceState.getSnapshot().extractedData;
    const kwh = inv?.consumption ?? 0;
    this.successCo2eKg.set(Math.round(kwh * CO2E_FACTOR_KG_PER_KWH * 1000) / 1000);
  }

  async finalizeAndCommit(): Promise<void> {
    if (this.isCommitting()) return;
    this.isCommitting.set(true);
    try {
      await this.pipeline.commitToBackend();
      this.computeSuccessCo2FromInvoice();
      this.showSuccess.set(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/version conflict|InvoiceVersionConflict/i.test(msg)) {
        throw new Error('VERSION_CONFLICT: Otra sesión modificó esta factura. Recarga o mantén tus cambios.');
      }
      throw e;
    } finally {
      this.isCommitting.set(false);
    }
  }

  async rejectInvoice(reason: string): Promise<void> {
    await this.pipeline.rejectCurrentInvoice(reason);
    this.resetFlow();
  }

  async retryAiProcessing(): Promise<void> {
    await this.pipeline.retryCurrentInvoice('Usuario solicitó reintento IA');
    this.ocrSimulating.set(true);
    this.ocrProgress.set(12);
  }

  async reloadFromBackend(): Promise<void> {
    const wip = this.wipStore.getSnapshot();
    if (!wip?.invoiceId) return;
    const snap = await this.pipeline.fetchWipFromBackend(wip.invoiceId);
    const latest = snap?.['latestExtractionDraft'];
    if (latest && typeof latest === 'object') {
      const draft = latest as Record<string, unknown>;
      const vendor = (draft['vendor'] as { name?: { value?: string } })?.name?.value ?? '';
      this.invoiceState.patchExtractedOptimistic({
        vendor,
        invoiceNumber: String((draft['invoiceNumber'] as { value?: string })?.value ?? ''),
        invoiceDate: String((draft['invoiceDate'] as { value?: string })?.value ?? ''),
        total: Number((draft['totalAmount'] as { numericValue?: number })?.numericValue ?? 0),
        consumption: Number((draft['consumption'] as { value?: { numericValue?: number } })?.value?.numericValue ?? 0),
        currency: String((draft['currency'] as { value?: string })?.value ?? 'EUR'),
        date: '',
        lines: [],
        confidence: Number(draft['overallConfidence'] ?? 0.8)
      });
    }
  }

  setDeviationAck(v: boolean): void {
    this.deviationAcknowledged.set(v);
  }

  canSubmitGuardrail(): boolean {
    if (!this.allocationMatchesInvoice()) return false;
    const h = this.invoiceState.getSnapshot().hierarchy;
    if (!h.branchId?.trim() || !h.buildingId?.trim()) return false;
    if (!this.hasConsumptionDeviationWarning()) {
      return true;
    }
    return this.deviationAcknowledged();
  }

  /** Restaura WIP si el usuario recargó la página a mitad del wizard. */
  tryRestoreWipSession(): boolean {
    const wip = this.wipStore.loadFromSession();
    if (!wip) return false;
    this.gatePassed.set(true);
    this.isOCR.set(wip.isOcr);
    if (wip.extractedData) {
      this.invoiceState.patchExtractedOptimistic(wip.extractedData);
    }
    if (wip.storageKey) {
      this.invoiceState.setStorageKey(wip.storageKey);
    }
    if (wip.invoiceId) {
      this.invoiceState.setInvoiceId(wip.invoiceId);
    }
    this.invoiceState.patchHierarchy(wip.hierarchy);
    if (wip.meterRows.length) {
      this.meterRows.set(wip.meterRows);
    }
    if (wip.isOcr && wip.extractedData) {
      this.workflow.setPhase('ready_for_review');
    }
    return true;
  }
}
