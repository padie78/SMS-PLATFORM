import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InvoiceValidationSplitViewComponent } from '../invoice-validation-split-view/invoice-validation-split-view.component';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import type { EnergyServiceType } from '@sms/common';
import type { InvoiceReviewView } from '../../../core/models/invoice-review.model';
import { InvoiceOnboardingUiService } from '../../../features/invoice-onboarding/services/invoice-onboarding-ui.service';
import { InvoiceStateService } from '../../../services/state/invoice-state.service';

const ENERGY_OPTIONS: ReadonlyArray<{ label: string; value: EnergyServiceType }> = [
  { label: 'Electricidad', value: 'ELECTRICITY' },
  { label: 'Gas', value: 'GAS' },
  { label: 'Agua', value: 'WATER' },
  { label: 'Vapor', value: 'STEAM' }
];

@Component({
  selector: 'app-invoice-onboarding-step-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    ButtonModule,
    TagModule,
    InvoiceValidationSplitViewComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-onboarding-step-form.component.html'
})
export class InvoiceOnboardingStepFormComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly invoiceState = inject(InvoiceStateService);
  readonly onboarding = inject(InvoiceOnboardingUiService);
  readonly energyOptions = ENERGY_OPTIONS;

  @Output() readonly continue = new EventEmitter<void>();

  readonly pdfFile = signal<File | null>(null);
  readonly activeField = signal<string | null>(null);
  readonly buildingOptions = signal<Array<{ label: string; value: string }>>([]);
  readonly isRejecting = signal(false);
  readonly isRetrying = signal(false);

  readonly form = this.fb.nonNullable.group({
    vendor: ['', [Validators.required, Validators.minLength(2)]],
    vendorTaxId: ['', [Validators.required, Validators.minLength(2)]],
    invoiceNumber: ['', [Validators.required]],
    billingPeriodStart: ['', [Validators.required]],
    billingPeriodEnd: ['', [Validators.required]],
    total: [0, [Validators.required, Validators.min(0.01)]],
    consumption: [0, [Validators.required, Validators.min(0.01)]],
    branchId: ['', [Validators.required]],
    buildingId: ['', [Validators.required]],
    energyType: ['ELECTRICITY' as EnergyServiceType, [Validators.required]]
  });

  ngOnInit(): void {
    const snap = this.invoiceState.getSnapshot();
    if (snap.file) {
      this.pdfFile.set(snap.file);
    }
    const d = snap.extractedData;
    const h = snap.hierarchy;
    if (d) {
      this.form.patchValue({
        vendor: d.vendor ?? '',
        vendorTaxId: d.vendorTaxId ?? '',
        invoiceNumber: d.invoiceNumber ?? '',
        billingPeriodStart: d.billingPeriodStart ?? '',
        billingPeriodEnd: d.billingPeriodEnd ?? '',
        total: d.total ?? 0,
        consumption: d.consumption ?? 0,
        branchId: h.branchId ?? '',
        buildingId: h.buildingId ?? '',
        energyType: 'ELECTRICITY'
      });
    }
    if (h.branchId) {
      this.buildingOptions.set(this.onboarding.buildingOptionsForBranch(h.branchId));
    }
    this.form.controls.branchId.valueChanges.subscribe((branchId) => {
      this.buildingOptions.set(this.onboarding.buildingOptionsForBranch(branchId));
      this.form.patchValue({ buildingId: '' }, { emitEvent: false });
    });
  }

  ngOnDestroy(): void {
    this.pdfFile.set(null);
  }

  async rejectInvoice(): Promise<void> {
    this.isRejecting.set(true);
    try {
      await this.onboarding.rejectInvoice('Rechazada por el usuario en validación');
    } finally {
      this.isRejecting.set(false);
    }
  }

  async retryAi(): Promise<void> {
    this.isRetrying.set(true);
    try {
      await this.onboarding.retryAiProcessing();
    } finally {
      this.isRetrying.set(false);
    }
  }

  warnings(): ReadonlyArray<{ code?: string; field?: string; message?: string }> {
    return (this.onboarding.wipWarnings() as Array<{ code?: string; field?: string; message?: string }>) ?? [];
  }

  suspicious(): ReadonlyArray<{ field?: string; reason?: string; severity?: string }> {
    return (this.onboarding.wipSuspicious() as Array<{ field?: string; reason?: string; severity?: string }>) ?? [];
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const prev = this.invoiceState.getSnapshot().extractedData;
    const merged: InvoiceReviewView = {
      vendor: v.vendor.trim(),
      vendorTaxId: v.vendorTaxId.trim(),
      invoiceNumber: v.invoiceNumber.trim(),
      invoiceDate: v.billingPeriodEnd.trim(),
      total: Number(v.total),
      consumption: Number(v.consumption),
      currency: prev?.currency ?? 'EUR',
      date: v.billingPeriodEnd.trim(),
      billingPeriodStart: v.billingPeriodStart.trim(),
      billingPeriodEnd: v.billingPeriodEnd.trim(),
      lines: prev?.lines ?? [],
      confidence: prev?.confidence ?? 0,
      cups: prev?.cups,
      contractReference: prev?.contractReference,
      netAmount: prev?.netAmount,
      taxAmount: prev?.taxAmount
    };
    this.invoiceState.patchExtractedOptimistic(merged);
    this.onboarding.patchHierarchyFromForm(v.branchId, v.buildingId);
    this.onboarding.setEnergyType(v.energyType);
    this.onboarding.setVendorTaxId(v.vendorTaxId.trim());
    this.continue.emit();
  }
}
