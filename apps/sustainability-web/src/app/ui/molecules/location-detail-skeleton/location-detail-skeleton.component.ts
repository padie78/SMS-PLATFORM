import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Skeleton del panel de detalle del Location Manager.
 *
 * Aparece durante la transición entre selecciones del árbol (~350 ms) y al
 * arrancar la página antes de que el detail-explorer tenga `node` real.
 * Imita la estructura visible del form actual: header con badge + ID, tabs
 * placeholder y una grilla de campos. Esto evita el "salto en blanco" entre
 * forms y le da percepción de carga premium.
 */
@Component({
  selector: 'sms-location-detail-skeleton',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full min-w-0 h-full' },
  template: `
    <div
      class="flex h-full w-full min-w-0 flex-col"
      role="status"
      aria-busy="true"
      aria-live="polite"
      [attr.aria-label]="label"
    >
      <span class="sr-only">{{ label }}</span>

      <div class="mx-auto w-full max-w-[980px] space-y-5 md:space-y-6">
        <header class="w-full border-b border-slate-200/90 pb-4 md:pb-5">
          <div class="sms-skel-eyebrow sms-skel-shimmer" aria-hidden="true"></div>
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 md:mt-4">
            <div class="sms-skel-badge sms-skel-shimmer" aria-hidden="true"></div>
            <div class="sms-skel-id sms-skel-shimmer" aria-hidden="true"></div>
          </div>
        </header>

        <div class="flex w-full flex-wrap gap-2" aria-hidden="true">
          @for (tab of tabs; track tab) {
            <div
              class="sms-skel-tab sms-skel-shimmer"
              [style.width]="tab"
            ></div>
          }
        </div>

        <div class="grid grid-cols-12 gap-x-4 gap-y-5 sm:gap-x-5 sm:gap-y-6" aria-hidden="true">
          @for (field of fields; track field.id) {
            <div [class]="field.colSpanClass">
              <div class="sms-skel-label sms-skel-shimmer"></div>
              <div class="mt-2 sms-skel-input sms-skel-shimmer"></div>
            </div>
          }
        </div>

        <div class="flex w-full items-center justify-end gap-2 border-t border-slate-100 pt-4" aria-hidden="true">
          <div class="sms-skel-btn sms-skel-btn--secondary sms-skel-shimmer"></div>
          <div class="sms-skel-btn sms-skel-btn--primary sms-skel-shimmer"></div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sms-skel-eyebrow {
        width: 120px;
        height: 10px;
        border-radius: 999px;
        background: rgb(226 232 240);
      }

      .sms-skel-badge {
        width: 96px;
        height: 22px;
        border-radius: 999px;
        background: rgb(209 250 229); /* emerald-100 */
      }

      .sms-skel-id {
        width: 280px;
        height: 14px;
        border-radius: 999px;
        background: rgb(226 232 240);
        max-width: 60%;
      }

      .sms-skel-tab {
        height: 34px;
        border-radius: 0.75rem;
        background: rgb(241 245 249); /* slate-100 */
      }

      .sms-skel-label {
        width: 55%;
        height: 11px;
        border-radius: 999px;
        background: rgb(226 232 240);
      }

      .sms-skel-input {
        width: 100%;
        height: 40px;
        border-radius: 12px;
        background: rgb(241 245 249);
        border: 1px solid rgb(226 232 240);
      }

      .sms-skel-btn {
        height: 36px;
        border-radius: 12px;
      }
      .sms-skel-btn--secondary {
        width: 88px;
        background: rgb(241 245 249);
      }
      .sms-skel-btn--primary {
        width: 140px;
        background: rgb(187 247 208); /* green-200 */
      }

      .sms-skel-shimmer {
        position: relative;
        overflow: hidden;
        isolation: isolate;
      }
      .sms-skel-shimmer::after {
        content: '';
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0) 0%,
          rgba(255, 255, 255, 0.85) 50%,
          rgba(255, 255, 255, 0) 100%
        );
        animation: sms-skel-shimmer-anim 1.35s ease-in-out infinite;
      }

      @keyframes sms-skel-shimmer-anim {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(120%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sms-skel-shimmer::after {
          animation: none;
          opacity: 0.5;
        }
      }
    `
  ]
})
export class LocationDetailSkeletonComponent {
  @Input() label = 'Cargando detalle de la ubicación…';

  /** Anchos predefinidos de los tabs placeholder (px → ancho aprox del label real). */
  readonly tabs: ReadonlyArray<string> = ['72px', '92px', '108px', '78px'];

  /**
   * Definición declarativa de los campos del grid placeholder. `colSpanClass`
   * usa las mismas mdCols del grid real (4 / 6 / 12) para que el skeleton
   * conserve EXACTAMENTE el layout que va a aparecer cuando llegue el form
   * verdadero. Resultado: cero "layout shift" cuando termina la carga.
   */
  readonly fields: ReadonlyArray<{ id: string; colSpanClass: string }> = [
    { id: '1', colSpanClass: 'col-span-12 md:col-span-8' },
    { id: '2', colSpanClass: 'col-span-12 md:col-span-4' },
    { id: '3', colSpanClass: 'col-span-12 md:col-span-6' },
    { id: '4', colSpanClass: 'col-span-12 md:col-span-6' },
    { id: '5', colSpanClass: 'col-span-12 md:col-span-6' },
    { id: '6', colSpanClass: 'col-span-12 md:col-span-6' },
    { id: '7', colSpanClass: 'col-span-12 md:col-span-4' },
    { id: '8', colSpanClass: 'col-span-12 md:col-span-4' },
    { id: '9', colSpanClass: 'col-span-12 md:col-span-4' }
  ];
}
