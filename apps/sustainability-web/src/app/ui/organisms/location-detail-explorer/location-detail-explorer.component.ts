import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { SmsLocationNode } from '../../../core/models/sms-location-node.model';
import { LocationDtoFormsHostComponent } from '../../../features/location/ui/forms/location-dto-forms-host.component';
import { LocationDetailSkeletonComponent } from '../../molecules/location-detail-skeleton/location-detail-skeleton.component';

@Component({
  selector: 'sms-detail-explorer',
  standalone: true,
  imports: [CommonModule, LocationDtoFormsHostComponent, LocationDetailSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full min-w-0 h-full'
  },
  template: `
    <div class="flex h-full w-full min-w-0 flex-col">
      <!-- Loading transitorio: se activa cuando el padre cambia la selección
           en el árbol y se apaga ~350ms después. Da la sensación de "carga
           del registro" aunque los datos ya estén en memoria. Si el nodo
           seleccionado todavía no llegó (race con la inicialización), también
           cae acá. -->
      <ng-container *ngIf="loading; else readyView">
        <sms-location-detail-skeleton />
      </ng-container>

      <ng-template #readyView>
        <div
          *ngIf="node as selected; else empty"
          class="mx-auto w-full max-w-[980px] space-y-5 md:space-y-6"
        >
          <header class="w-full border-b border-slate-200/90 pb-4 md:pb-5">
            <h2 class="m-0 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
              Properties
            </h2>
            <div class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 md:mt-3">
              <span
                class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900"
              >
                {{ selected.type }}
              </span>
              <span class="break-all font-mono text-xs font-semibold text-slate-800 sm:text-sm">
                {{ selected.location_id }}
              </span>
            </div>
          </header>

          <div class="w-full min-w-0">
            <sms-location-dto-forms-host [node]="selected" />
          </div>
        </div>

        <ng-template #empty>
          <div
            class="flex h-full w-full min-h-[200px] min-w-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-sm text-slate-600 md:min-h-[280px] md:p-6"
          >
            <div class="w-full min-w-0 max-w-md px-1">
              <i
                class="pi pi-mouse-pointer mb-2 block text-2xl text-slate-400"
                aria-hidden="true"
              ></i>
              <p class="m-0 min-w-0 break-words text-base font-semibold leading-snug text-slate-700">
                Seleccioná un nodo del árbol
              </p>
              <p class="m-0 mt-2 min-w-0 break-words text-xs leading-relaxed text-slate-500">
                Desde el panel izquierdo elegí cualquier nivel de la jerarquía para editar o agregar
                propiedades.
              </p>
            </div>
          </div>
        </ng-template>
      </ng-template>
    </div>
  `
})
export class LocationDetailExplorerComponent {
  /** Valor actual del nodo; el padre debe enlazar `location.selectedNode()` para que OnPush reciba inputs nuevos al cambiar la señal. */
  @Input() node: SmsLocationNode | null = null;

  /**
   * Cuando es `true`, el panel oculta el form y muestra el skeleton.
   * El padre lo activa en cada cambio de `selectedNode()` y lo apaga después
   * de un delay corto para dar percepción premium de "cargando registro".
   */
  @Input() loading = false;
}

