import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal
} from '@angular/core';
import type { MenuItem } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';
import { TreeDragDropService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ContextMenuModule } from 'primeng/contextmenu';
import { DragDropModule } from 'primeng/dragdrop';
import { TreeModule } from 'primeng/tree';
import type { TreeNode } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { LocationTreeNodeTemplateComponent } from '../../molecules/location-tree-node-template/location-tree-node-template.component';
import { LocationTreeSkeletonComponent } from '../../molecules/location-tree-skeleton/location-tree-skeleton.component';
import type { SmsLocationNode, SmsLocationNodeType } from '../../../core/models/sms-location-node.model';
import { buildLocationNodeTooltipText } from '../../../features/location/utils/location-node-tooltip.util';
import { isSmsTreeDraftNode } from '../../../features/location/lib/location-tree-helpers';
import { LocationService } from '../../../features/location/services/location.service';
import { NotificationService } from '../../../services/ui/notification.service';

function nextChildTypes(parentType: SmsLocationNodeType | null): SmsLocationNodeType[] {
  switch (parentType) {
    case null:
      return ['ORGANIZATION'];
    case 'ORGANIZATION':
      return ['REGION'];
    case 'REGION':
      return ['BRANCH'];
    case 'BRANCH':
      return ['BUILDING'];
    case 'BUILDING':
      return ['ASSET'];
    case 'ASSET':
      return ['METER'];
    case 'METER':
      return [];
    default:
      return [];
  }
}

function labelForType(t: SmsLocationNodeType): string {
  switch (t) {
    case 'ORGANIZATION':
      return 'Organización';
    case 'REGION':
      return 'Región';
    case 'BRANCH':
      return 'Sucursal';
    case 'BUILDING':
      return 'Edificio';
    case 'ASSET':
      return 'Activo';
    case 'METER':
      return 'Medidor';
    default:
      return 'Nodo';
  }
}

function draftTreePlaceholderName(t: SmsLocationNodeType): string {
  return `${labelForType(t)} · borrador`;
}

function iconForType(t: SmsLocationNodeType): string {
  switch (t) {
    case 'ORGANIZATION':
      return 'pi pi-building';
    case 'REGION':
      return 'pi pi-globe';
    case 'BRANCH':
      return 'pi pi-map-marker';
    case 'BUILDING':
      return 'pi pi-warehouse';
    case 'COST_CENTER':
      return 'pi pi-wallet';
    case 'ASSET':
      return 'pi pi-box';
    case 'METER':
      return 'pi pi-bolt';
    default:
      return 'pi pi-circle';
  }
}



/**
 * Datos derivados que el template del nodo lee desde `node.data` para
 * renderizar badges y tooltips sin recalcular en cada change-detection.
 *
 * - `childCount`: cantidad de hijos directos. Para nodos `BRANCH` que aún no
 *   se expandieron (el árbol es lazy), guardamos `null` para indicar
 *   "tiene hijos pero el conteo todavía no está disponible".
 * - `tooltipText`: resumen multilínea (metadata + consumo + huella + auditoría).
 */
interface SmsTreeNodeBadgeData {
  childCount?: number | null;
  tooltipText: string;
}

function buildTooltipText(node: SmsLocationNode): string {
  return buildLocationNodeTooltipText(node);
}

/**
 * Tipos de nodo que pueden contener hijos en la jerarquía SMS.
 * Mantener sincronizado con `LocationTreeNodeTemplateComponent.canHaveChildren`.
 */
const PARENT_TYPES: ReadonlySet<SmsLocationNodeType> = new Set([
  'ORGANIZATION',
  'REGION',
  'BRANCH',
  'BUILDING',
  'ASSET'
]);

/**
 * Recorre recursivamente el árbol y persiste `childCount` (para cualquier
 * tipo de nodo padre) y `tooltipText` en `node.data`. El template del nodo
 * lo consume vía `node.data.childCount` y `[pTooltip]="node.data.tooltipText"`.
 */
function decorateTreeNodeBadgeData(nodes: SmsLocationNode[]): SmsLocationNode[] {
  for (const node of nodes) {
    const children = (node.children ?? []) as SmsLocationNode[];

    // Preservamos la `data` original del nodo (el modelo de dominio que
    // PrimeNG usa) y le agregamos las claves visuales encima en lugar de
    // sobrescribirla. Así no perdemos referencias para selección/lazy.
    const existing = (node.data ?? {}) as Partial<SmsTreeNodeBadgeData> & Record<string, unknown>;
    const data: Partial<SmsTreeNodeBadgeData> & Record<string, unknown> = { ...existing };
    data.tooltipText = buildTooltipText(node);

    if (node.type && PARENT_TYPES.has(node.type)) {
      // Caso 1: hijos ya expandidos → conteo real.
      // Caso 2: lazy (sin children cargados) y `hasChildren=true` → `null`
      //          como placeholder para que el template muestre el badge con "?".
      // Caso 3: lazy y `hasChildren=false` → 0 (sin hijos, no se muestra badge).
      if (children.length > 0) {
        data.childCount = children.length;
      } else if (node.hasChildren === true) {
        data.childCount = null;
      } else {
        data.childCount = 0;
      }
    } else {
      delete data.childCount;
    }

    node.data = data;

    if (children.length > 0) decorateTreeNodeBadgeData(children);
  }
  return nodes;
}

@Component({
  selector: 'sms-master-tree',
  standalone: true,
  imports: [
    CommonModule,
    TreeModule,
    DragDropModule,
    ContextMenuModule,
    ButtonModule,
    ConfirmDialogModule,
    TooltipModule,
    LocationTreeNodeTemplateComponent,
    LocationTreeSkeletonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConfirmationService, TreeDragDropService],
  styles: [
    `
      :host ::ng-deep .sms-tree.p-tree {
        border: 0;
        background: transparent;
        color: rgb(15 23 42);
      }

      :host ::ng-deep .sms-tree .p-tree-filter-container {
        padding: 0.6rem 0.65rem 0.45rem 0.65rem;
        border-bottom: 1px solid rgb(226 232 240);
        background: linear-gradient(to bottom, rgba(248, 250, 252, 0.95), rgba(255, 255, 255, 0));
      }

      :host ::ng-deep .sms-tree .p-tree-filter {
        border-radius: 0.8rem;
        border-color: rgb(226 232 240);
        font-size: 0.78rem;
        padding-top: 0.45rem;
        padding-bottom: 0.45rem;
      }

      :host ::ng-deep .sms-tree .p-tree-container {
        padding: 0.35rem 0.45rem 0.55rem;
      }

      :host ::ng-deep .sms-tree .p-treenode {
        margin: 0.045rem 0;
      }

      /* Ancho INTRÍNSECO: dejamos que cada nodo (con su ícono + label +
         badge) determine su ancho natural. El panel padre (location-manager)
         se ajusta a \`max-content\` con un cap defensivo. Así el árbol se
         lee completo sin recortar nombres. \`min-width: 100%\` garantiza
         que cuando el contenido es más corto que el panel, igual ocupe
         todo el ancho (hover/selección bonitos). */
      :host ::ng-deep .sms-tree .p-treenode {
        width: max-content;
        min-width: 100%;
        max-width: none;
      }

      :host ::ng-deep .sms-tree .p-treenode-content {
        width: max-content;
        min-width: 100%;
        max-width: none;
        flex-wrap: nowrap;
        padding: 0.05rem 0.2rem;
        gap: 0.35rem;
        box-shadow: none;
      }

      /* Hover y selección esmeralda viven en styles.css global porque
         las reglas con :host ::ng-deep pelean con el tema Lara y a veces
         pierden la batalla de especificidad. */

      /* Tooltip vive en styles.css global porque pTooltip usa appendTo body. */

      :host ::ng-deep .sms-tree .p-tree-toggler {
        width: 1.45rem;
        height: 1.45rem;
        min-width: 1.45rem;
        border-radius: 0.55rem;
        color: rgb(100 116 139);
        transition:
          transform 140ms ease,
          background-color 120ms ease,
          color 120ms ease;
      }

      :host ::ng-deep .sms-tree .p-tree-toggler .p-icon {
        width: 0.65rem;
        height: 0.65rem;
      }

      :host ::ng-deep .sms-tree .p-tree-toggler:hover {
        background: rgba(236, 253, 245, 0.85); /* emerald-50 */
        color: rgb(5 150 105); /* emerald-600 */
      }

      :host ::ng-deep .sms-tree .p-tree-toggler:focus {
        box-shadow: none;
        outline: 2px solid rgba(110, 231, 183, 0.55); /* emerald-300 */
        outline-offset: 1px;
      }

      :host ::ng-deep .sms-tree .p-treenode-children {
        padding-left: 0.95rem;
        margin-left: 0.45rem;
        border-left: 1px solid rgba(226, 232, 240, 0.72);
        transition:
          opacity 160ms ease,
          transform 160ms ease;
      }

      :host ::ng-deep .sms-tree .p-treenode-content .p-treenode-label {
        flex: 0 0 auto;
        width: auto;
        white-space: nowrap;
      }

      /* Drag & drop affordance */
      :host ::ng-deep .sms-tree .p-treenode-content.p-treenode-dragover {
        background: rgba(191, 219, 254, 0.55); /* sky */
        box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.25);
      }

      :host ::ng-deep .sms-tree .p-tree-loading-overlay {
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.68);
        backdrop-filter: blur(2px);
      }

      /* Scrollbar (WebKit) */
      :host ::ng-deep .sms-tree .p-tree-container::-webkit-scrollbar {
        width: 10px;
      }
      :host ::ng-deep .sms-tree .p-tree-container::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.35);
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.8);
      }
      :host ::ng-deep .sms-tree .p-tree-container::-webkit-scrollbar-thumb:hover {
        background: rgba(100, 116, 139, 0.45);
      }
    `
  ],
  template: `
    <div class="flex h-full flex-col gap-3 md:gap-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <div class="text-xs font-black uppercase tracking-wider text-slate-600">
              Organización
            </div>
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-slate-500">
            Creá nodos desde el menú contextual y movelos con drag &amp; drop respetando la
            jerarquía.
          </div>
        </div>
        <div
          class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end"
        >
          <button
            pButton
            type="button"
            class="p-button-outlined border-round-xl flex-1 text-xs font-bold sm:flex-none"
            icon="pi pi-plus"
            label="Crear organización"
            (click)="createOrganization()"
          ></button>
          <button
            pButton
            type="button"
            class="p-button-text border-round-xl text-xs font-bold"
            icon="pi pi-refresh"
            label="Recargar"
            (click)="reload.emit()"
          ></button>
        </div>
      </div>

      <p-contextMenu #cm [model]="contextMenuItems()" />
      <p-confirmDialog />

      <div class="relative flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm">
        <!-- Overlay sutil de "Actualizando…" cuando hay árbol pintado y se está
             recargando (soft reload). NO bloquea interacción: el usuario puede
             seguir leyendo y, si demora más de ~300ms, percibe el feedback. -->
        <div
          *ngIf="loading && treeNodes.length > 0"
          class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center px-3 py-2"
          role="status"
          aria-live="polite"
        >
          <div
            class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-800 shadow-sm backdrop-blur"
          >
            <i class="pi pi-spin pi-spinner text-[10px]" aria-hidden="true"></i>
            Actualizando jerarquía…
          </div>
        </div>

        <ng-template #emptyState>
          <div class="h-full flex flex-column align-items-center justify-content-center gap-3 p-6 text-center">
            <div class="inline-flex align-items-center justify-content-center w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200">
              <i class="pi pi-sitemap text-indigo-700 text-xl" aria-hidden="true"></i>
            </div>
            <div class="max-w-md">
              <div class="text-sm font-black text-slate-900">Todavía no hay nodos en tu jerarquía</div>
              <div class="text-[12px] text-slate-500 mt-1 leading-relaxed">
                Empezá creando una <span class="font-semibold text-slate-700">Organización</span>. Luego vas a poder agregar
                regiones y el resto de niveles.
              </div>
              <div class="text-[11px] text-slate-400 mt-2" data-testid="location-tree-empty">
                Tip: si esto aparece y esperabas ver datos, revisá la carga de raíces ("loadRoots") o el mock storage.
              </div>
            </div>
            <button
              pButton
              type="button"
              class="p-button border-round-xl text-xs font-bold"
              icon="pi pi-plus"
              label="Crear organización"
              (click)="createOrganization()"
            ></button>
          </div>
        </ng-template>

        <div class="h-full flex flex-column" *ngIf="(treeNodes?.length ?? 0) > 0; else noTreeOrLoading">
          <!-- Remount explícito sin @for+track: así no dispara NG0956 (track que cambia borra el único ítem). -->
          @if (pTreeMounted()) {
            <p-tree
              class="sms-tree h-full overflow-auto"
              [value]="treeNodes"
              [filter]="true"
              filterMode="lenient"
              [filterBy]="'label,location_id'"
              filterPlaceholder="Buscar por nombre o ID…"
              [lazy]="true"
              [loading]="loading"
              [draggableNodes]="true"
              [droppableNodes]="true"
              [contextMenu]="cm"
              selectionMode="single"
              [(selection)]="selection"
              (onNodeSelect)="onSelect($event)"
              (onNodeContextMenuSelect)="onContextSelect($event)"
              (onNodeExpand)="onExpand($event)"
              (onNodeDrop)="onDrop($event)"
              (onFilter)="onFilter($event)"
            >
              <!--
                PrimeNG p-tree resuelve el template buscando \`templateMap[node.type]\`.
                Si el tipo no está registrado, NO cae al "default" y renderiza
                \`{{ node.label }}\` plano (sin badge, tooltip ni quick actions).
                Por eso registramos un \`<ng-template pTemplate="<TYPE>">\` por
                cada SmsLocationNodeType, todos delegando al mismo \`#treeNodeTpl\`.
              -->
              <ng-template pTemplate="default" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="ORGANIZATION" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="REGION" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="BRANCH" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="BUILDING" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="COST_CENTER" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="ASSET" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
              <ng-template pTemplate="METER" let-node>
                <ng-container *ngTemplateOutlet="treeNodeTpl; context: { $implicit: node }"></ng-container>
              </ng-template>
            </p-tree>
          }

          <!-- Único punto de definición del template del nodo del árbol. -->
          <ng-template #treeNodeTpl let-node>
            <sms-tree-node-template
              [node]="asSmsNode(node)"
              [filterQuery]="filterQuery()"
              [pTooltip]="tooltipFor(node)"
              tooltipPosition="right"
              tooltipStyleClass="sms-tree-tooltip"
              [showDelay]="280"
              [hideDelay]="60"
              [autoHide]="true"
              appendTo="body"
              (createChild)="onQuickCreateChild($event)"
              (edit)="onQuickEdit($event)"
              (delete)="onQuickDelete($event)"
            />
          </ng-template>
        </div>

        <ng-template #noTreeOrLoading>
          <!-- Carga inicial: en vez de un spinner aislado mostramos un skeleton
               con la geometría real del árbol. Es el patrón "premium" usado
               por Vercel/Linear/Notion: el usuario percibe progreso continuo
               y la transición a contenido real no produce layout shift. -->
          <div
            *ngIf="loading && treeNodes.length === 0"
            class="h-full flex flex-column min-h-[280px]"
          >
            <sms-location-tree-skeleton />
          </div>
          <ng-container *ngIf="!loading && treeNodes.length === 0">
            <ng-container *ngTemplateOutlet="emptyState"></ng-container>
          </ng-container>
        </ng-template>
      </div>
    </div>
  `
})
export class LocationMasterTreeComponent implements OnChanges {
  /**
   * TODO (arquitectura): este organismo no debería depender del feature store.
   * Se mantiene temporalmente para evitar cambios extensivos en una sola pasada.
   */
  private readonly location = inject(LocationService);
  private readonly confirm = inject(ConfirmationService);
  private readonly notify = inject(NotificationService);
  private readonly cdr = inject(ChangeDetectorRef);

  treeNodes: SmsLocationNode[] = [];

  @Input({ required: true }) set nodes(value: SmsLocationNode[] | null | undefined) {
    const arr = value ?? [];
    decorateTreeNodeBadgeData(arr);
    this.treeNodes = arr;
    this.cdr.markForCheck();
  }
  get nodes(): SmsLocationNode[] {
    return this.treeNodes;
  }

  /** Se incrementa en el store al recargar o dar de alta; destruye y recrea el `p-tree` (lazy suele ignorar cambios en `[value]`). */
  @Input({ required: true }) treeViewEpoch = 0;

  /** Desmontaje/monte del `p-tree` al subir la época, sin usar `@for`+`track` (evita NG0956). */
  readonly pTreeMounted = signal(true);

  @Input() loading = false;

  @Output() selected = new EventEmitter<SmsLocationNode>();
  @Output() dropped = new EventEmitter<{ nodeId: string; newParentId: string | null }>();
  @Output() reload = new EventEmitter<void>();

  /**
   * Acciones rápidas del menú contextual que el padre debe resolver
   * (abrir modales, navegar a páginas específicas, etc.).
   * Se mantiene como union explícito para que el padre haga `switch` exhaustivo.
   */
  @Output() quickAction = new EventEmitter<{
    node: SmsLocationNode;
    action: 'openCostCenters' | 'openTariffs' | 'openAssetsInventory';
  }>();

  selection: TreeNode | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const epochCh = changes['treeViewEpoch'];
    const epochBumped =
      !!epochCh &&
      epochCh.previousValue !== epochCh.currentValue &&
      epochCh.previousValue !== undefined;

    if (epochBumped) {
      this.pTreeMounted.set(false);
      queueMicrotask(() => {
        this.pTreeMounted.set(true);
        this.syncSelectionWithStore();
        this.cdr.markForCheck();
      });
      return;
    }

    if (!changes['nodes'] && !changes['treeViewEpoch']) return;
    queueMicrotask(() => this.syncSelectionWithStore());
  }

  /**
   * Tras reemplazar el árbol (p.ej. `saveNode` + reload), PrimeNG suele mantener
   * `selection` apuntando a instancias viejas; re-enlaza al TreeNode vivo del nuevo `[value]`.
   */
  private syncSelectionWithStore(): void {
    const id = this.location.selectedNode()?.location_id ?? null;
    if (!id) {
      if (this.selection != null) {
        this.selection = null;
        this.cdr.markForCheck();
      }
      return;
    }
    const match = this.findTreeNodeByLocationId(this.treeNodes, id);
    if (match !== this.selection) {
      this.selection = match;
      this.cdr.markForCheck();
    }
  }

  private findTreeNodeByLocationId(nodes: readonly SmsLocationNode[], id: string): TreeNode | null {
    for (const n of nodes) {
      if (n.location_id === id) {
        return n as TreeNode;
      }
      const kids = (n.children ?? []) as SmsLocationNode[];
      if (kids.length > 0) {
        const found = this.findTreeNodeByLocationId(kids, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Texto del tooltip que el `<p-tooltip>` enlaza al nodo del árbol.
   *
   * Usa `node.data.tooltipText` si fue precomputado por
   * `decorateTreeNodeBadgeData`; si no (caso lazy donde el padre se decoró
   * pero el hijo todavía no), lo construye on-the-fly. Garantiza que SIEMPRE
   * haya un resumen visible al hover.
   */
  tooltipFor(node: TreeNode): string {
    const data = (node.data ?? {}) as { tooltipText?: string } | null;
    if (data?.tooltipText && data.tooltipText.trim().length > 0) {
      return data.tooltipText;
    }
    const sms = this.asSmsNode(node);
    return buildTooltipText(sms);
  }

  asSmsNode(node: TreeNode): SmsLocationNode {
    // En `withPrimeTreeFields` seteamos `data: node`, así el wrapper TreeNode
    // y el modelo de dominio coexisten. Si `data` parece tener `location_id`
    // confiamos en él; si no, el `node` mismo ya es un `SmsLocationNode`.
    const maybeData = node.data as SmsLocationNode | undefined;
    const resolved = maybeData?.location_id ? maybeData : (node as unknown as SmsLocationNode);

    return {
      ...resolved,
      data: node.data ?? resolved.data,
      children: (node.children ?? resolved.children) as SmsLocationNode[] | undefined,
      expanded: node.expanded ?? resolved.expanded,
      icon: resolved.icon ?? node.icon ?? (resolved.type ? iconForType(resolved.type) : 'pi pi-circle'),
      location_id: resolved.location_id ?? node.key ?? '',
      name: resolved.name ?? node.label ?? ''
    } as SmsLocationNode;
  }

  private readonly contextTarget = signal<SmsLocationNode | null>(null);
  /** Texto del filtro global; se propaga al template del nodo para resaltar coincidencias. */
  readonly filterQuery = signal<string>('');

  readonly contextMenuItems = computed<MenuItem[]>(() => {
    const target = this.contextTarget();

    // Click derecho sobre área vacía: ofrecer crear organización para no dejar al usuario sin opciones.
    if (!target) {
      return [
        {
          label: 'Crear organización',
          icon: 'pi pi-plus',
          command: () => void this.createOrganization()
        }
      ];
    }

    const editLabel = ((): string => {
      switch (target.type) {
        case 'ORGANIZATION':
          return 'Configurar organización';
        case 'REGION':
          return 'Configurar región';
        case 'BRANCH':
          return 'Configurar sucursal';
        case 'BUILDING':
          return 'Configurar edificio';
        case 'COST_CENTER':
          return 'Configurar centro de costo';
        case 'ASSET':
          return 'Configurar activo';
        case 'METER':
          return 'Configurar medidor';
        default:
          return 'Editar';
      }
    })();

    // Acciones específicas por tipo. Las que no tienen routing aún quedan `disabled` como hint.
    const specific: MenuItem[] = ((): MenuItem[] => {
      switch (target.type) {
        case 'ORGANIZATION':
          return [
            {
              label: 'Nuevo centro de costo…',
              icon: 'pi pi-wallet',
              command: () => this.quickAction.emit({ node: target, action: 'openCostCenters' })
            },
            { label: 'Dashboard ESG', icon: 'pi pi-chart-line', disabled: true }
          ];
        case 'REGION':
          return [
            { label: 'Indicadores de la región', icon: 'pi pi-chart-pie', disabled: true }
          ];
        case 'BRANCH':
          return [
            {
              label: 'Tarifas energéticas',
              icon: 'pi pi-bolt',
              command: () =>
                void this.quickAction.emit({ node: target, action: 'openTariffs' })
            },
            {
              label: 'Nuevo centro de costo…',
              icon: 'pi pi-wallet',
              command: () =>
                void this.quickAction.emit({ node: target, action: 'openCostCenters' })
            },
            {
              label: 'Abrir detalle sucursal',
              icon: 'pi pi-folder-open',
              command: () => this.selected.emit(target)
            }
          ];
        case 'BUILDING':
          return [
            { label: 'Inventario de activos', icon: 'pi pi-th-large', command: () => this.selected.emit(target) }
          ];
        case 'COST_CENTER':
          return [
            { label: 'Resumen presupuestario', icon: 'pi pi-wallet', disabled: true }
          ];
        case 'ASSET':
          return [
            { label: 'Histórico de consumo', icon: 'pi pi-chart-bar', disabled: true },
            { label: 'Acciones prescriptivas', icon: 'pi pi-bullseye', disabled: true }
          ];
        case 'METER':
          return [
            { label: 'Lecturas IoT en vivo', icon: 'pi pi-server', disabled: true }
          ];
        default:
          return [];
      }
    })();

    const create: MenuItem[] = nextChildTypes(target.type).map((t: SmsLocationNodeType) => ({
      label: `Crear ${labelForType(t)}`,
      icon: 'pi pi-plus',
      command: () => void this.createChild(target, t)
    }));

    const items: MenuItem[] = [
      {
        label: editLabel,
        icon: 'pi pi-pencil',
        command: () => this.selected.emit(target)
      }
    ];
    if (specific.length > 0) {
      items.push({ separator: true });
      items.push(...specific);
    }
    if (create.length > 0) {
      items.push({ separator: true });
      items.push(...create);
    }
    items.push(
      { separator: true },
      {
        label: `Eliminar ${labelForType(target.type).toLowerCase()}`,
        icon: 'pi pi-trash',
        styleClass: 'text-rose-700 font-semibold',
        command: () => void this.confirmDelete(target)
      }
    );
    return items;
  });

  onSelect(event: { node?: TreeNode }): void {
    if (!event.node) return;
    const node = this.asSmsNode(event.node);
    if (!node.location_id) return;
    this.contextTarget.set(node);
    this.selected.emit(node);
  }

  /**
   * Sincroniza `contextTarget` cuando el usuario abre el menú contextual sobre un nodo,
   * de modo que las opciones del menú reflejen exactamente al nodo apuntado.
   */
  onContextSelect(event: { node?: TreeNode }): void {
    if (!event.node) return;
    const node = this.asSmsNode(event.node);
    if (!node.location_id) return;
    this.contextTarget.set(node);
  }

  /**
   * Filtro global: actualiza el query (para highlight) y expande automáticamente
   * los ancestros de cualquier nodo cuyo nombre o ID coincida con la búsqueda.
   * No colapsa al limpiar para preservar el contexto de navegación del usuario.
   */
  onFilter(event: { filter?: string | null }): void {
    const query = (event.filter ?? '').trim();
    this.filterQuery.set(query);
    if (query.length === 0) return;
    this.expandAncestorsOfMatches(this.treeNodes, query.toLowerCase());
  }

  private expandAncestorsOfMatches(nodes: SmsLocationNode[], q: string): boolean {
    let anyMatch = false;
    for (const n of nodes) {
      const nameMatch = (n.name ?? '').toLowerCase().includes(q);
      const idMatch = (n.location_id ?? '').toLowerCase().includes(q);
      const children = (n.children ?? []) as SmsLocationNode[];
      const childMatch = children.length > 0 ? this.expandAncestorsOfMatches(children, q) : false;
      if (childMatch) {
        n.expanded = true;
        anyMatch = true;
      }
      if (nameMatch || idMatch) {
        anyMatch = true;
      }
    }
    return anyMatch;
  }

  async onExpand(event: { node?: TreeNode }): Promise<void> {
    if (!event.node) return;

    // Resolvemos el modelo de dominio: en algunos casos PrimeNG nos pasa el
    // wrapper TreeNode con `data` apuntando al SmsLocationNode original;
    // en otros (cuando el árbol carga el nodo de raíz directamente como
    // SmsLocationNode), `event.node` ya ES el modelo. Cubrimos ambos.
    const dataNode = event.node.data as SmsLocationNode | undefined;
    const direct = event.node as unknown as SmsLocationNode;
    const target = dataNode?.location_id ? dataNode : direct;
    if (!target?.location_id) return;

    await this.location.ensureChildrenLoaded(target);

    // Tras cargar los hijos lazy, decoramos íconos + badges + tooltips
    // para que el template los renderice. Sin esto los hijos aparecen
    // "pelados" (sin ícono ni tooltip) hasta el siguiente refresh.
    const children = (target.children ?? []) as SmsLocationNode[];
    if (children.length > 0) {
      decorateTreeNodeBadgeData(children);
    }

    // Re-decoramos el padre para refrescar `childCount` (deja de ser '?'
    // y pasa al número real ahora que los hijos están cargados).
    decorateTreeNodeBadgeData([target]);
  }

  onDrop(event: { dragNode?: TreeNode | null; dropNode?: TreeNode | null }): void {
    const dragNode = event.dragNode ?? undefined;
    const drag = dragNode?.data as SmsLocationNode | undefined;
    const drop = (event.dropNode?.data as SmsLocationNode | undefined) ?? null;
    if (!drag) return;
    const verdict = this.location.validateDrop(drag, drop);
    if (!verdict.ok) {
      this.location.lastError.set(verdict.reason ?? 'Invalid drop');
      this.reload.emit();
      return;
    }
    this.dropped.emit({ nodeId: drag.location_id, newParentId: drop?.location_id ?? null });
  }

  async onQuickCreateChild(parent: SmsLocationNode): Promise<void> {
    const next = nextChildTypes(parent.type)[0];
    if (!next) {
      this.location.lastError.set(`"${parent.type}" no admite hijos.`);
      return;
    }
    await this.createChild(parent, next);
    this.reload.emit();
  }

  onQuickEdit(node: SmsLocationNode): void {
    this.selected.emit(node);
  }

  onQuickDelete(node: SmsLocationNode): void {
    void this.confirmDelete(node);
  }

  async createOrganization(): Promise<void> {
    try {
      const draft = this.location.addOrganizationDraftToTree();
      this.location.lastError.set(null);
      this.notify.show(
        'info',
        'Borrador en el árbol',
        'Completá el formulario a la derecha y pulsá Guardar para crear la organización en el sistema.'
      );
      this.selected.emit(draft);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error preparando borrador';
      this.location.lastError.set(msg);
      this.notify.error('No se pudo añadir el borrador', msg);
      throw e;
    }
  }

  async createRegion(parent: SmsLocationNode | null): Promise<void> {
    if (!parent || parent.type !== 'ORGANIZATION') {
      const msg = 'Primero creá o seleccioná una Organización.';
      this.location.lastError.set(msg);
      this.notify.show('warn', 'No se puede crear la región', msg);
      return;
    }
    if (isSmsTreeDraftNode(parent)) {
      this.notify.show(
        'warn',
        'Borrador pendiente',
        `Guardá primero "${parent.name}" desde el formulario antes de crear una región debajo.`
      );
      return;
    }
    try {
      const draft = this.location.addLocationNodeDraftToTree({
        parent_id: parent.location_id,
        type: 'REGION',
        name: draftTreePlaceholderName('REGION')
      });
      parent.expanded = true;
      parent.leaf = false;
      parent.hasChildren = true;
      this.location.lastError.set(null);
      this.notify.show(
        'info',
        'Borrador en el árbol',
        'Completá el formulario a la derecha y pulsá Guardar para registrar la región en el sistema.'
      );
      this.selected.emit(draft);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido preparando borrador de región';
      this.notify.error('No se pudo añadir el borrador', msg);
      throw e;
    }
  }

  private async createChild(parent: SmsLocationNode | null, type: SmsLocationNodeType): Promise<void> {
    if (parent && isSmsTreeDraftNode(parent)) {
      this.notify.show(
        'warn',
        'Borrador pendiente',
        `Guardá primero "${parent.name}" desde el formulario antes de agregar niveles jerárquicos debajo.`
      );
      return;
    }
    if (type === 'REGION') {
      await this.createRegion(parent);
      return;
    }
    try {
      const name = draftTreePlaceholderName(type);
      const draft = this.location.addLocationNodeDraftToTree({
        parent_id: parent?.location_id ?? null,
        type,
        name
      });
      if (parent) {
        parent.expanded = true;
        parent.leaf = false;
        parent.hasChildren = true;
      }
      const childLabel = labelForType(type);
      this.location.lastError.set(null);
      this.notify.show(
        'info',
        'Borrador en el árbol',
        `Completá el formulario y pulsá Guardar para crear el ${childLabel.toLowerCase()} en el sistema.`
      );
      this.selected.emit(draft);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : `Error desconocido creando borrador (${labelForType(type)})`;
      this.notify.error(`No se pudo añadir el borrador (${labelForType(type)})`, msg);
      throw e;
    }
  }

  private async confirmDelete(node: SmsLocationNode): Promise<void> {
    try {
      const hasChildren = await this.location.hasDirectChildren(node);
      if (hasChildren) {
        const msg = `No se puede eliminar "${node.name}" porque tiene nodos hijos. Eliminá primero los hijos.`;
        this.location.lastError.set(msg);
        this.notify.show('warn', 'Eliminación bloqueada', msg);
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido cargando hijos para validar eliminación';
      this.location.lastError.set(msg);
      this.notify.error('Error validando jerarquía', msg);
      return;
    }
    const typeLabel = labelForType(node.type);
    this.confirm.confirm({
      message: `¿Eliminar "${node.name}" (${typeLabel})? Esta acción no se puede deshacer.`,
      header: 'Confirmar eliminación',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.location.deleteNode(node.location_id);
          this.notify.success(
            `${typeLabel} eliminado`,
            `Se eliminó "${node.name}" del árbol.`
          );
          this.reload.emit();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Error desconocido eliminando nodo';
          this.location.lastError.set(msg);
          this.notify.error(`No se pudo eliminar el ${typeLabel.toLowerCase()}`, msg);
        }
      },
      reject: () => {
        this.notify.show('info', 'Eliminación cancelada', `"${node.name}" se mantiene en el árbol.`);
      }
    });
  }
}

