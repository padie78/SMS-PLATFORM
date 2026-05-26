import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { InvoiceOnboardingUiService } from '../../../features/invoice-onboarding/services/invoice-onboarding-ui.service';
import { InvoiceStateService } from '../../../services/state/invoice-state.service';

@Component({
  selector: 'app-invoice-onboarding-guardrail-review',
  standalone: true,
  imports: [CommonModule, FormsModule, MessageModule, CheckboxModule, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600 m-0 mb-4">Guardrail — revisión final</h3>
        <p class="text-sm text-slate-500 m-0 leading-relaxed">
          Última validación antes de impactar el golden record en DynamoDB. Verifica consumo, ubicación y reparto por medidor.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 m-0 rounded-xl border border-slate-200 bg-slate-50/80 p-5 md:p-6">
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase m-0">Proveedor</p>
          <p class="m-0 mt-1 mb-0 font-semibold text-slate-900">{{ snap().extractedData?.vendor }}</p>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase m-0">Consumo factura</p>
          <p class="m-0 mt-1 mb-0 font-bold text-slate-900">
            {{ snap().extractedData?.consumption | number : '1.0-2' }} kWh
          </p>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase m-0">Promedio histórico (mock)</p>
          <p class="m-0 mt-1 mb-0 font-bold text-slate-900">{{ historical }} kWh</p>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase m-0">Desviación</p>
          <p class="m-0 mt-1 mb-0 font-bold" [class.text-amber-700]="warn()" [class.text-emerald-700]="!warn()">
            {{ deviationPct() | number : '1.1-1' }} %
          </p>
        </div>
      </div>

      @if (warn()) {
        <p-message severity="warn" styleClass="w-full rounded-xl">
          El consumo se desvía más del 20% respecto al promedio histórico mock.
        </p-message>
        <div class="flex items-start gap-2">
          <p-checkbox [binary]="true" inputId="dev-ack" [ngModel]="ackModel" (ngModelChange)="onAck($event)" />
          <label for="dev-ack" class="text-sm text-slate-700 leading-relaxed cursor-pointer">
            Declaro bajo juramento que la desviación está justificada y acepto continuar con el registro.
          </label>
        </div>
      }

      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-2 border-t border-slate-200">
        <p class="text-xs text-slate-500 m-0">
          Al confirmar, los datos temporales se consolidan en la base de datos (registro definitivo).
        </p>
        <p-button
          label="Confirmar y persistir"
          icon="pi pi-database"
          styleClass="p-button-emerald rounded-xl text-xs font-bold px-6"
          [disabled]="!canSubmit() || onboarding.isCommitting()"
          [loading]="onboarding.isCommitting()"
          (onClick)="emitSubmit()"
        />
      </div>
    </div>
  `
})
export class InvoiceOnboardingGuardrailReviewComponent implements OnInit {
  private readonly invoiceState = inject(InvoiceStateService);
  readonly onboarding = inject(InvoiceOnboardingUiService);

  @Output() readonly submitReview = new EventEmitter<void>();

  readonly snap = this.invoiceState.snapshot;

  readonly historical = this.onboarding.historicalAvgKwh();

  ackModel = false;

  ngOnInit(): void {
    this.ackModel = this.onboarding.deviationAcknowledged();
  }

  deviationPct(): number {
    return this.onboarding.consumptionDeviationPct();
  }

  warn(): boolean {
    return this.onboarding.hasConsumptionDeviationWarning();
  }

  canSubmit(): boolean {
    return this.onboarding.canSubmitGuardrail();
  }

  onAck(v: boolean): void {
    this.onboarding.setDeviationAck(!!v);
    this.ackModel = !!v;
  }

  emitSubmit(): void {
    if (!this.canSubmit()) return;
    this.submitReview.emit();
  }
}
