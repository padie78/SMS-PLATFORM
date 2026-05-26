import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { map, startWith } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type {
  CostAllocationMethod,
  CostCenterDTO,
  CostCenterForecastModel,
  LifecycleStatus
} from '@sms/common';
import {
  CostAllocationMethodSchema,
  CostCenterForecastModelSchema,
  LifecycleStatusSchema
} from '@sms/common';
import { CostCenterEntity } from '@sms/domain';

import {
  COST_CENTER_FORM_ENUM_OPTIONS,
  COST_CENTER_FORM_TABS,
  buildCostCenterFormGroup,
  costCenterFormRawValueToDTO,
  hydrateCostCenterFormFromPartial,
  type CostCenterFormFieldDef,
  type CostCenterFormGroup,
  type CostCenterFormShape,
  type CostCenterFormValue,
  type SelectOption
} from './cost-center-form.config';
import { LocationFormFieldComponent } from './location-form-field.component';

export interface OrganizationCostCenterDialogData {
  readonly organizationId: string;
  readonly costCenter?: CostCenterDTO | null;
}

interface CostCenterDialogTabDef {
  readonly id: 'general' | 'finance' | 'sustainability';
  readonly label: string;
  readonly headline: string;
  readonly fields: ReadonlyArray<CostCenterFormFieldDef>;
}

function generateLocalCostCenterId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  return typeof cryptoRef?.randomUUID === 'function'
    ? cryptoRef.randomUUID()
    : `cc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const ALL_FIELDS: ReadonlyArray<CostCenterFormFieldDef> = COST_CENTER_FORM_TABS.flatMap(
  (tab) => tab.fields
);

function pickField(key: keyof CostCenterFormValue): CostCenterFormFieldDef {
  const field = ALL_FIELDS.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Cost center field not found: ${String(key)}`);
  // Forzamos mdCols: 6 (grid de 2 columnas) según diseño del modal.
  return { ...field, mdCols: 6 } as CostCenterFormFieldDef;
}

const DIALOG_TABS: ReadonlyArray<CostCenterDialogTabDef> = Object.freeze([
  {
    id: 'general',
    label: 'General',
    headline: 'Identidad y responsable',
    fields: [
      pickField('name'),
      pickField('externalId'),
      pickField('type'),
      pickField('managerEmail')
    ]
  },
  {
    id: 'finance',
    label: 'Finanzas',
    headline: 'Presupuesto, moneda y umbrales',
    fields: [
      pickField('annualBudget'),
      pickField('currency'),
      pickField('budgetThresholdAlert')
    ]
  },
  {
    id: 'sustainability',
    label: 'Sostenibilidad',
    headline: 'Carbono, intensidad y superficie',
    fields: [
      pickField('carbonBudgetTons'),
      pickField('targetIntensity'),
      pickField('floorAreaSqm')
    ]
  }
]);

@Component({
  selector: 'sms-organization-cost-center-form-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, LocationFormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full min-w-0 box-border'
  },
  template: `
    <form class="flex w-full min-w-0 flex-col gap-4 box-border" [formGroup]="form" novalidate>
      <input type="hidden" formControlName="id" />
      <input type="hidden" formControlName="organizationId" />

      <div
        class="w-full rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-2 shadow-sm box-border"
      >
        <div
          role="tablist"
          aria-label="Secciones centro de costo"
          class="flex w-full min-w-0 flex-wrap gap-1.5 sm:gap-2"
        >
          @for (tab of tabs; track tab.id) {
            <button
              type="button"
              role="tab"
              class="flex-1 rounded-xl px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider outline-none ring-emerald-500/0 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:flex-none sm:px-4 sm:py-2.5 sm:text-left"
              [attr.aria-selected]="activeTabId() === tab.id"
              [ngClass]="
                activeTabId() === tab.id
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/10 ring-1 ring-emerald-500/30'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200/80 hover:bg-emerald-50/90 hover:text-emerald-900 hover:ring-emerald-200/60'
              "
              (click)="selectTab(tab.id)"
            >
              {{ tab.label }}
            </button>
          }
        </div>
      </div>

      @for (tab of tabs; track tab.id) {
        @if (activeTabId() === tab.id) {
          <div
            class="box-border w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5 md:p-6"
          >
            <h3 class="mb-4 text-base font-bold text-slate-800">{{ tab.headline }}</h3>
            <div class="sms-form-grid grid grid-cols-12 gap-x-4 gap-y-5 sm:gap-x-5 sm:gap-y-6">
              @for (field of tab.fields; track field.key) {
                <sms-location-form-field
                  [field]="field"
                  formIdPrefix="organization-cost-center-field-"
                  [options]="enumOptions(field.enumKey)"
                />
              }
            </div>
          </div>
        }
      }

      @if (errorMsg()) {
        <div
          role="alert"
          class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[12px] font-semibold text-rose-700"
        >
          {{ errorMsg() }}
        </div>
      }

      <div class="flex w-full flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          pButton
          type="button"
          label="Cancelar"
          icon="pi pi-times"
          severity="secondary"
          class="border-round-xl text-xs font-bold"
          (click)="cancel()"
        ></button>
        <button
          pButton
          type="button"
          [label]="isEdit() ? 'Actualizar centro de costo' : 'Crear centro de costo'"
          icon="pi pi-save"
          class="border-round-xl text-xs font-bold"
          [disabled]="formInvalid()"
          (click)="save()"
        ></button>
      </div>
    </form>
  `
})
export class OrganizationCostCenterFormDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly config = inject(DynamicDialogConfig<OrganizationCostCenterDialogData>);
  private readonly ref = inject(DynamicDialogRef<CostCenterDTO | null>);

  readonly form: CostCenterFormGroup = buildCostCenterFormGroup(this.fb);
  readonly controls = this.form.controls as CostCenterFormShape;

  /**
   * Estado de validez del form como signal. Con `ChangeDetectionStrategy.OnPush`,
   * un binding directo a `form.invalid` no se re-evalúa cuando el usuario tipea
   * (Angular no dispara CD por cambios internos del FormControl). El signal
   * sí lo dispara → el botón "Crear" se habilita en cuanto el form es válido.
   *
   * `startWith(form.status)` evita el primer frame con `undefined` y refleja
   * desde el inicio si el form ya nace inválido (típico: `name` vacío).
   */
  readonly formInvalid = toSignal(
    this.form.statusChanges.pipe(
      startWith(this.form.status),
      map((status) => status !== 'VALID')
    ),
    { initialValue: this.form.status !== 'VALID' }
  );

  readonly tabs: ReadonlyArray<CostCenterDialogTabDef> = DIALOG_TABS;
  readonly activeTabId = signal<CostCenterDialogTabDef['id']>(DIALOG_TABS[0]?.id ?? 'general');

  readonly isEdit = signal(false);
  readonly errorMsg = signal<string | null>(null);

  ngOnInit(): void {
    const data = this.config.data;
    if (!data?.organizationId?.trim()) {
      this.errorMsg.set('Falta organizationId para crear el centro de costo.');
      return;
    }

    hydrateCostCenterFormFromPartial(this.form, {
      ...(data.costCenter ?? {}),
      organizationId: data.organizationId.trim()
    });

    if (!this.form.controls.id.value.trim()) {
      this.form.controls.id.setValue(generateLocalCostCenterId(), { emitEvent: false });
    }

    this.isEdit.set(Boolean(data.costCenter?.id));
    this.form.controls.organizationId.disable({ emitEvent: false });
    this.form.controls.id.disable({ emitEvent: false });

    // CRÍTICO: `buildLocationFormGroup` aplica una regla de producto que arranca
    // TODOS los `select` no-readonly con `null` (para forzar al usuario a elegir
    // explícitamente desde el placeholder). En el form completo de cost center
    // hay 4 selects required: `type`, `forecastModel`, `status`, `allocationMethod`.
    //
    // El modal SOLO expone `type` (tab "General"), pero los otros 3 forman parte
    // del FormGroup completo y, al estar `null + required`, mantienen el form
    // permanentemente inválido → el botón "Crear" nunca se habilita.
    //
    // Solución: rellenar con defaults seguros del propio enum los 3 selects
    // ocultos. El usuario podrá ajustarlos luego desde el form completo en el
    // panel derecho del location manager. `type` se respeta en null para que
    // el dropdown del modal muestre el placeholder y el usuario lo elija.
    this.applyHiddenRequiredSelectDefaults();

    this.form.updateValueAndValidity({ emitEvent: true });
    this.form.markAllAsTouched();
  }

  /**
   * Asigna defaults a los selects required que existen en el FormGroup pero no
   * tienen UI en este modal. Idempotente: solo escribe si el valor es `null`,
   * lo que permite que un futuro `data.costCenter` precargado (edición) prevalezca.
   */
  private applyHiddenRequiredSelectDefaults(): void {
    const forecastCtrl = this.form.controls.forecastModel;
    if (forecastCtrl.value == null) {
      const def = (CostCenterForecastModelSchema.options as readonly CostCenterForecastModel[])[0];
      forecastCtrl.setValue(def, { emitEvent: false });
    }

    const statusCtrl = this.form.controls.status;
    if (statusCtrl.value == null) {
      const opts = LifecycleStatusSchema.options as readonly LifecycleStatus[];
      const preferred = opts.find((o) => o === 'ACTIVE') ?? opts[0];
      statusCtrl.setValue(preferred, { emitEvent: false });
    }

    const allocCtrl = this.form.controls.allocationMethod;
    if (allocCtrl.value == null) {
      const def = (CostAllocationMethodSchema.options as readonly CostAllocationMethod[])[0];
      allocCtrl.setValue(def, { emitEvent: false });
    }
  }

  selectTab(id: CostCenterDialogTabDef['id']): void {
    this.activeTabId.set(id);
  }

  enumOptions(
    key: keyof typeof COST_CENTER_FORM_ENUM_OPTIONS | undefined
  ): Array<SelectOption<string>> {
    if (!key) return [];
    return [...COST_CENTER_FORM_ENUM_OPTIONS[key]] as SelectOption<string>[];
  }

  save(): void {
    this.errorMsg.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMsg.set('Revisá los campos obligatorios del centro de costo.');
      return;
    }

    try {
      const dto = costCenterFormRawValueToDTO(this.form.getRawValue() as CostCenterFormValue);
      const entity = CostCenterEntity.fromDTO(dto);
      this.ref.close(entity.toValue());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo procesar el centro de costo.';
      this.errorMsg.set(msg);
    }
  }

  cancel(): void {
    this.ref.close(null);
  }
}
