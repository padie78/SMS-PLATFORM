import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StepperModule } from 'primeng/stepper';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';

import { InvoiceUploadComponent } from './steps/upload.component';
import { InvoiceStateService } from '../../../services/state/invoice-state.service';
import { WorkflowStateService } from '../../../services/state/workflow-state.service';
import { InvoiceOnboardingUiService } from '../../../features/invoice-onboarding/services/invoice-onboarding-ui.service';
import { NotificationService } from '../../../services/ui/notification.service';
import { InvoiceOnboardingGateComponent } from '../../../ui/organisms/invoice-onboarding-gate/invoice-onboarding-gate.component';
import { InvoiceOnboardingStepFormComponent } from '../../../ui/organisms/invoice-onboarding-step-form/invoice-onboarding-step-form.component';
import { InvoiceOnboardingMeterAllocationComponent } from '../../../ui/organisms/invoice-onboarding-meter-allocation/invoice-onboarding-meter-allocation.component';
import { InvoiceOnboardingGuardrailReviewComponent } from '../../../ui/organisms/invoice-onboarding-guardrail-review/invoice-onboarding-guardrail-review.component';
import { InvoiceOnboardingSuccessPanelComponent } from '../../../ui/organisms/invoice-onboarding-success-panel/invoice-onboarding-success-panel.component';

@Component({
  selector: 'app-invoice-create',
  standalone: true,
  imports: [
    CommonModule,
    StepperModule,
    ButtonModule,
    ProgressBarModule,
    InvoiceUploadComponent,
    InvoiceOnboardingGateComponent,
    InvoiceOnboardingStepFormComponent,
    InvoiceOnboardingMeterAllocationComponent,
    InvoiceOnboardingGuardrailReviewComponent,
    InvoiceOnboardingSuccessPanelComponent
  ],
  templateUrl: './invoice-create.component.html'
})
export class InvoiceCreateComponent implements OnInit {
  private readonly stateService = inject(InvoiceStateService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly notifications = inject(NotificationService);
  readonly onboarding = inject(InvoiceOnboardingUiService);

  /** 0 Documento, 1 Datos, 2 Medidores, 3 Guardrail */
  activeStepIndex = 0;

  /**
   * Onboarding UI es singleton: sin reset al entrar, `gatePassed` seguiría true tras una visita
   * anterior y no se mostraría OCR vs manual.
   */
  ngOnInit(): void {
    const restored = this.onboarding.tryRestoreWipSession();
    if (!restored) {
      this.stateService.clear();
      this.workflow.reset();
      this.onboarding.resetFlow();
      this.activeStepIndex = 0;
    } else {
      this.activeStepIndex = this.onboarding.workflowPhase() === 'ready_for_review' ? 1 : 0;
    }
  }

  private readonly maxStepIndex = 3;

  onUploadDone(nextCallback: unknown): void {
    this.advance(nextCallback);
  }

  onFormDone(nextCallback: unknown): void {
    this.advance(nextCallback);
  }

  onMetersDone(nextCallback: unknown): void {
    this.advance(nextCallback);
  }

  async onGuardrailSubmit(): Promise<void> {
    try {
      await this.onboarding.finalizeAndCommit();
      this.cdr.markForCheck();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la factura';
      this.notifications.error('Error al confirmar', message);
      this.cdr.markForCheck();
    }
  }

  prevStep(prevCallback?: unknown): void {
    if (prevCallback) {
      this.executePrimeNGCallback(prevCallback);
    } else if (this.activeStepIndex > 0) {
      this.activeStepIndex--;
    }
  }

  private advance(nextCallback: unknown): void {
    const before = this.activeStepIndex;
    this.executePrimeNGCallback(nextCallback);
    if (this.activeStepIndex <= before) {
      this.activeStepIndex = Math.min(before + 1, this.maxStepIndex);
    }
    if (this.activeStepIndex === 2) {
      this.onboarding.initMeterRowsFromConsumption();
    }
    this.cdr.detectChanges();
  }

  private executePrimeNGCallback(callback: unknown): void {
    if (this.isEmitLike(callback)) {
      callback.emit();
      return;
    }
    if (typeof callback === 'function') {
      (callback as () => void)();
      return;
    }
    this.activeStepIndex = Math.min(this.activeStepIndex + 1, this.maxStepIndex);
  }

  private isEmitLike(callback: unknown): callback is { emit: () => void } {
    return (
      typeof callback === 'object' &&
      callback !== null &&
      'emit' in callback &&
      typeof (callback as { emit: unknown }).emit === 'function'
    );
  }

  resetProcess(): void {
    this.stateService.clear();
    this.workflow.reset();
    this.onboarding.resetFlow();
    this.activeStepIndex = 0;
  }
}
