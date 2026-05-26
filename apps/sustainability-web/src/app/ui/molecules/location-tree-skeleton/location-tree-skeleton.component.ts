import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Skeleton del árbol de Location Manager.
 *
 * Se muestra mientras el store inicializa el árbol (primera carga / refresh
 * completo). Replica visualmente la geometría real de la jerarquía:
 *
 *  Organización
 *   └─ Region
 *       └─ Branch
 *           └─ Building
 *           └─ Building
 *
 * Cada barra es un placeholder con shimmer (gradiente animado horizontal).
 * Standalone + OnPush + sin Inputs requeridos para componer fácil en padres.
 */
@Component({
  selector: 'sms-location-tree-skeleton',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    <div
      class="sms-skeleton-tree flex w-full flex-col gap-2 px-2 py-3 sm:gap-2.5 sm:px-3 sm:py-4"
      role="status"
      aria-busy="true"
      aria-live="polite"
      [attr.aria-label]="label"
    >
      <span class="sr-only">{{ label }}</span>

      @for (row of rows; track row.id) {
        <div
          class="flex items-center gap-2.5"
          [style.padding-left.rem]="row.indent"
        >
          <span class="sms-skel-icon sms-skel-shimmer" aria-hidden="true"></span>
          <span
            class="sms-skel-bar sms-skel-shimmer"
            [style.width]="row.barWidth"
            aria-hidden="true"
          ></span>
          @if (row.showBadge) {
            <span class="sms-skel-badge sms-skel-shimmer" aria-hidden="true"></span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sms-skel-icon {
        width: 18px;
        height: 18px;
        border-radius: 6px;
        background: rgb(226 232 240); /* slate-200 */
        flex: 0 0 auto;
      }

      .sms-skel-bar {
        height: 12px;
        border-radius: 999px;
        background: rgb(226 232 240); /* slate-200 */
      }

      .sms-skel-badge {
        width: 28px;
        height: 16px;
        border-radius: 999px;
        background: rgb(226 232 240);
        flex: 0 0 auto;
        margin-left: 0.25rem;
      }

      /* Shimmer: barre de izquierda a derecha con un gradiente que aclara
         brevemente la zona central. Patrón sin JS y sin layout thrash. */
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
export class LocationTreeSkeletonComponent {
  /** Texto accesible para lectores de pantalla. Override opcional desde el padre. */
  @Input() label = 'Cargando jerarquía de ubicaciones…';

  /**
   * Geometría del skeleton. Construida estática (no recalcula nada) para que
   * OnPush no tenga work extra y cada render sea barato.
   *
   * - `indent`: padding-left en `rem` que simula la profundidad jerárquica.
   * - `barWidth`: ancho del placeholder de label (CSS clamp con porcentajes
   *   para que se adapte al panel sin reflow).
   * - `showBadge`: simula el badge de "cantidad de hijos" en algunos nodos
   *   para reforzar el realismo del placeholder.
   */
  readonly rows: ReadonlyArray<{
    id: string;
    indent: number;
    barWidth: string;
    showBadge: boolean;
  }> = [
    { id: 'org', indent: 0, barWidth: '62%', showBadge: true },
    { id: 'region-1', indent: 1.1, barWidth: '54%', showBadge: true },
    { id: 'branch-1', indent: 2.2, barWidth: '48%', showBadge: true },
    { id: 'building-1', indent: 3.3, barWidth: '42%', showBadge: false },
    { id: 'building-2', indent: 3.3, barWidth: '38%', showBadge: false },
    { id: 'region-2', indent: 1.1, barWidth: '58%', showBadge: true },
    { id: 'branch-2', indent: 2.2, barWidth: '46%', showBadge: false },
    { id: 'branch-3', indent: 2.2, barWidth: '50%', showBadge: false }
  ];
}
