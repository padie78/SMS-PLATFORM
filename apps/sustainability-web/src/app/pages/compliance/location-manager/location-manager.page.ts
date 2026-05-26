import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import type { MenuItem } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import type { CostCenterDTO, TariffDTO } from '@sms/common';
import { LocationMasterTreeComponent } from '../../../ui/organisms/location-master-tree/location-master-tree.component';
import { LocationDetailExplorerComponent } from '../../../ui/organisms/location-detail-explorer/location-detail-explorer.component';
import { LocationService } from '../../../features/location/services/location.service';
import type { SmsLocationNode } from '../../../core/models/sms-location-node.model';
import { OrganizationCostCenterRegistryService } from '../../../services/state/organization-cost-center-registry.service';
import { OrganizationCostCenterFormDialogComponent } from '../../../features/location/ui/forms/organization-cost-center-form-dialog.component';
import { TariffFormDialogComponent } from '../../../features/location/ui/forms/tariff-form-dialog.component';
import { resolveHierarchyContext } from '../../../features/location/ui/forms/location-hierarchy-context';
import { isSmsTreeDraftNode } from '../../../features/location/lib/location-tree-helpers';
import { NotificationService } from '../../../services/ui/notification.service';

type QuickAction = 'openCostCenters' | 'openTariffs' | 'openAssetsInventory';

const GRAPHQL_ROOT_PARENT_IDS = new Set(['', 'ROOT']);

function smsNodeStableLocationId(node: SmsLocationNode): string {
  const byField = typeof node.location_id === 'string' ? node.location_id.trim() : '';
  if (byField) return byField;
  const treeKey = (node as { key?: string }).key;
  return typeof treeKey === 'string' ? treeKey.trim() : '';
}

@Component({
  selector: 'sms-location-manager-page',
  standalone: true,
  imports: [
    CommonModule,
    BreadcrumbModule,
    DynamicDialogModule,
    LocationMasterTreeComponent,
    LocationDetailExplorerComponent
  ],
  providers: [DialogService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* =========================================================
         Layout 2-paneles · sin p-splitter
         ---------------------------------------------------------
         Decisión: el panel del árbol toma un ancho natural acotado
         (clamp 280–420px) y el panel del form se queda con TODO
         el espacio restante. Garantiza máxima superficie para los
         formularios sin que el árbol se sienta apretado.

         - Desktop (≥md): row, panel-tree ancho fijo, panel-form flex-1.
         - Mobile (<md):  column, panel-tree primero, panel-form abajo,
                          ambos al 100% del ancho disponible.
         ========================================================= */
      .sms-loc-layout {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        min-width: 0;
      }

      @media (min-width: 900px) {
        .sms-loc-layout {
          flex-direction: row;
        }
      }

      .sms-loc-layout__tree {
        flex: 0 0 auto;
        width: 100%;
        min-width: 0;
      }

      @media (min-width: 900px) {
        /* El panel toma el ancho INTRÍNSECO del árbol (max-content) para
           que toda la jerarquía se lea sin scroll horizontal interno.
           Bounds:
            - min  300px → cuando el árbol está vacío o sólo tiene roots,
                           el panel no colapsa.
            - max  min(50vw, 560px) → cap defensivo para que un nombre muy
                           largo no se coma el espacio del form. Si el
                           árbol excede ese tope, scrollea horizontalmente
                           dentro del panel (overflow-x: auto). */
        .sms-loc-layout__tree {
          flex: 0 0 auto;
          width: max-content;
          min-width: 300px;
          max-width: min(50vw, 560px);
          overflow-x: auto;
        }
      }

      .sms-loc-layout__detail {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
      }

      .sms-loc-layout__divider {
        background: rgb(226 232 240); /* slate-200 */
        flex: 0 0 auto;
      }

      @media (min-width: 900px) {
        .sms-loc-layout__divider {
          width: 1px;
          align-self: stretch;
        }
      }

      @media (max-width: 899px) {
        .sms-loc-layout__divider {
          height: 1px;
          width: 100%;
        }
      }
    `
  ],
  template: `
    <div
      class="mx-auto w-full max-w-[1600px] min-w-0 space-y-4 px-3 pb-8 sm:space-y-5 sm:px-4 sm:pb-10 md:space-y-6 md:px-6 md:pb-12 lg:px-8"
    >
      <header
        class="flex flex-col gap-4 sm:gap-5 md:flex-row md:items-start md:justify-between md:gap-6"
      >
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            SMS · Trust &amp; Compliance
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <h1 class="m-0 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
              Location Manager
            </h1>
            <span
              class="rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-800"
            >
              UI v2
            </span>
          </div>
          <p class="m-0 mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
            La raíz es tu <strong class="text-slate-700">Organización</strong>. Desde ahí modelás la
            jerarquía operativa y energética:
            <span class="font-mono text-slate-600">
              Region → Branch → Building → Cost Center → Asset → Meter
            </span>
            . Usá el árbol para crear nodos y
            <strong class="text-slate-700">drag &amp; drop</strong> para reubicar (valida la
            jerarquía).
          </p>
        </div>
        <div class="min-w-0 shrink-0 md:max-w-[420px]">
          <div
            class="overflow-x-auto rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
          >
            <p-breadcrumb
              [model]="breadcrumbItems()"
              styleClass="bg-transparent border-none p-0 text-sm whitespace-nowrap"
            />
          </div>
        </div>
      </header>

      <section
        class="rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-800 sm:p-4 md:p-5"
        *ngIf="location.lastError() as err"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-exclamation-triangle mt-1"></i>
          <div class="min-w-0">
            <div class="text-[11px] font-black uppercase tracking-wider">Error</div>
            <div class="break-words">{{ err }}</div>
          </div>
        </div>
      </section>

      <section
        class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div class="sms-loc-layout min-h-[560px] sm:min-h-[640px] md:min-h-[720px] xl:min-h-[760px]">
          <aside
            class="sms-loc-layout__tree bg-gradient-to-b from-slate-50/70 via-white to-white p-3 sm:p-4 md:p-5 lg:p-6"
            aria-label="Árbol de organización"
          >
            <sms-master-tree
              [nodes]="location.tree()"
              [treeViewEpoch]="location.treeViewEpoch()"
              [loading]="location.loading()"
              (selected)="onNodeSelected($event)"
              (dropped)="onNodeDropped($event)"
              (quickAction)="onQuickAction($event)"
              (reload)="reload()"
            />
          </aside>
          <div class="sms-loc-layout__divider" aria-hidden="true"></div>
          <div
            class="sms-loc-layout__detail overflow-auto p-3 sm:p-4 md:p-5 lg:p-7"
          >
            <sms-detail-explorer
              [node]="location.selectedNode()"
              [loading]="detailLoading()"
            />
          </div>
        </div>
      </section>
    </div>
  `
})
export class LocationManagerPage implements OnInit {
  readonly location = inject(LocationService);
  private readonly dialog = inject(DialogService);
  private readonly costCenterRegistry = inject(OrganizationCostCenterRegistryService);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Loading "simulado" del panel de detalle cuando el usuario cambia de nodo
   * en el árbol. Los datos del nodo ya están en memoria, pero un skeleton
   * de ~350 ms da percepción premium de "cargando registro" y elimina el
   * cambio brusco entre forms (que con OnPush + diferentes tipos de nodo
   * se nota como un "salto en blanco").
   *
   * Si el usuario hace clics rápidos sucesivos, cada uno reinicia el timer
   * gracias al `onCleanup` del effect — el último cambio gana, no se acumulan
   * skeletons.
   */
  private readonly DETAIL_SKELETON_MS = 350;
  private readonly detailLoadingSig = signal(false);
  /** Lectura pública del signal (consumido por el template del detail panel). */
  readonly detailLoading = this.detailLoadingSig.asReadonly();

  constructor() {
    // Efecto reactivo: dispara el skeleton cada vez que cambia el nodo
    // seleccionado en el store. `onCleanup` cancela timers anteriores cuando
    // la selección cambia de nuevo antes de que termine el delay actual.
    effect(
      (onCleanup) => {
        const sel = this.location.selectedNode();
        // No mostramos skeleton cuando se "deselecciona" (vuelta a empty state).
        if (!sel) {
          this.detailLoadingSig.set(false);
          return;
        }

        this.detailLoadingSig.set(true);
        const id = window.setTimeout(() => {
          this.detailLoadingSig.set(false);
        }, this.DETAIL_SKELETON_MS);

        onCleanup(() => window.clearTimeout(id));
      },
      { allowSignalWrites: true }
    );

    // Garantizamos limpieza si el componente se destruye con un timer pendiente.
    // (effect's onCleanup ya lo cubre, pero defensivo ante futuros refactors.)
    this.destroyRef.onDestroy(() => this.detailLoadingSig.set(false));
  }

  readonly breadcrumbItems = computed<MenuItem[]>(() => {
    const nodes = this.location.breadcrumb();
    if (nodes.length === 0) {
      return [{ label: 'Organización' }];
    }
    return [
      { label: 'Organización', title: 'Root' },
      ...nodes.map((n) => ({
        label: n.name,
        title: `${n.type} · ${n.location_id}`
      }))
    ];
  });

  async ngOnInit(): Promise<void> {
    await this.location.loadRoots();
  }

  onNodeSelected(node: SmsLocationNode): void {
    this.location.selectedNode.set(node);
  }

  async onNodeDropped(ev: { nodeId: string; newParentId: string | null }): Promise<void> {
    await this.location.updateParent(ev.nodeId, ev.newParentId);
  }

  /**
   * Acciones rápidas del menú contextual del árbol.
   * - `openCostCenters`: crea un Cost Center a nivel organización (desde org o desde
   *   sucursal se resuelve la org por la jerarquía del árbol).
   * - `openTariffs` (sucursal): modal de nueva tarifa y persistencia en `metadata.tariffs`.
   */
  onQuickAction(ev: { node: SmsLocationNode; action: QuickAction }): void {
    // Selecciono el nodo (el detail explorer también muestra el form correspondiente).
    this.location.selectedNode.set(ev.node);

    switch (ev.action) {
      case 'openCostCenters': {
        const orgNode =
          ev.node.type === 'ORGANIZATION' ? ev.node : this.resolveOrganizationNode(ev.node);
        if (orgNode) {
          this.openOrganizationCostCenterDialog(orgNode);
        } else {
          this.notify.show(
            'warn',
            'Sin organización',
            'No se pudo resolver la organización para abrir el centro de costo.'
          );
        }
        break;
      }
      case 'openTariffs':
        if (ev.node.type === 'BRANCH') {
          this.openBranchTariffCreateDialog(ev.node);
        }
        break;
      case 'openAssetsInventory':
        break;
    }
  }

  private findNodeByLocationId(nodes: readonly SmsLocationNode[], id: string): SmsLocationNode | null {
    for (const n of nodes) {
      if (n.location_id === id) return n;
      const kids = n.children as SmsLocationNode[] | undefined;
      if (kids?.length) {
        const found = this.findNodeByLocationId(kids, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Resuelve el `location_id` de la organización: primero refs `parent` de PrimeNG,
   * luego `metadata.organizationId` del DTO persistido y por último sube por `parent_id`
   * en el modelo (útil cuando el árbol no enlazó `node.parent`).
   */
  private resolveOrganizationLocationId(from: SmsLocationNode): string | null {
    const chain = resolveHierarchyContext(from).organizationId?.trim();
    if (chain) return chain;

    const metaOrg = from.metadata?.organizationId;
    if (typeof metaOrg === 'string') {
      const trimmed = metaOrg.trim();
      if (trimmed) return trimmed;
    }

    const tree = this.location.tree();
    const fromId = smsNodeStableLocationId(from);
    let curId: string | undefined = fromId || undefined;

    for (let depth = 0; depth < 40 && curId; depth++) {
      const resolved = this.findNodeByLocationId(tree, curId);
      const effective: SmsLocationNode | null = resolved ?? (curId === fromId ? from : null);
      if (!effective) break;
      if (effective.type === 'ORGANIZATION') return effective.location_id.trim();

      const pid = typeof effective.parent_id === 'string' ? effective.parent_id.trim() : '';
      if (!pid || GRAPHQL_ROOT_PARENT_IDS.has(pid)) break;
      curId = pid;
    }

    /** Índice remoto (`getTree`): siempre contiene enlaces parentId incluso cuando el subtree visible no encuentra ancestors. */
    return this.resolveOrganizationFromRemoteFlat(fromId);
  }

  private resolveOrganizationFromRemoteFlat(locationId: string): string | null {
    const flat = this.location.remoteFlat();
    let cur: string | undefined = locationId.trim() || undefined;
    for (let d = 0; d < 40 && cur; d++) {
      const row = flat.get(cur);
      if (!row) break;
      if (row.nodeType === 'ORGANIZATION') return row.id.trim();
      const p = row.parentId;
      const pid = typeof p === 'string' ? p.trim() : '';
      if (!pid || GRAPHQL_ROOT_PARENT_IDS.has(pid)) break;
      cur = pid;
    }
    return null;
  }

  private resolveOrganizationNode(from: SmsLocationNode): SmsLocationNode | null {
    const orgId = this.resolveOrganizationLocationId(from);
    if (!orgId) return null;
    return this.findNodeByLocationId(this.location.tree(), orgId);
  }

  /** Modal de nueva tarifa (misma UX que la pestaña Tarifas del formulario de sucursal). */
  private openBranchTariffCreateDialog(branchNode: SmsLocationNode): void {
    if (isSmsTreeDraftNode(branchNode)) {
      this.notify.show(
        'warn',
        'Sucursal pendiente',
        'Guardá la sucursal en el panel derecho antes de registrar tarifas.'
      );
      return;
    }
    const orgId = (this.resolveOrganizationLocationId(branchNode) ?? '').trim();
    const branchId = smsNodeStableLocationId(branchNode);
    if (!orgId || !branchId) {
      this.notify.error('No se puede abrir tarifas', 'Falta organización o ID de sucursal.');
      return;
    }

    const ref = this.dialog.open(TariffFormDialogComponent, {
      header: `Nueva tarifa · ${branchNode.name}`,
      width: '85vw',
      style: { 'max-width': '1100px' },
      contentStyle: { padding: '1.5rem', overflow: 'auto', 'max-height': '85vh' },
      modal: true,
      dismissableMask: false,
      closable: true,
      styleClass: 'rounded-2xl',
      data: { tariff: null, orgId, branchId }
    });

    ref.onClose.subscribe(async (result: TariffDTO | null | undefined) => {
      if (!result) return;
      try {
        const meta = branchNode.metadata as { tariffs?: unknown } | Record<string, unknown> | undefined;
        const prev = Array.isArray(meta?.tariffs)
          ? ([...(meta.tariffs as TariffDTO[])])
          : [];
        const nextMeta = {
          ...(branchNode.metadata ?? {}),
          tariffs: [...prev, result]
        };
        await this.location.updateNode(branchId, {
          metadata: nextMeta as NonNullable<SmsLocationNode['metadata']>
        });
        this.notify.success('Tarifa registrada', `Se agregó el contrato a "${branchNode.name}".`);
        await this.reload();
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : 'No se pudo guardar la tarifa en la sucursal.';
        this.notify.error('Error al guardar la tarifa', msg);
      }
    });
  }

  async reload(): Promise<void> {
    await this.location.loadRoots();
  }

  /** Abre el modal de creación de Cost Center y persiste al cerrar. */
  private openOrganizationCostCenterDialog(orgNode: SmsLocationNode): void {
    const ref = this.dialog.open(OrganizationCostCenterFormDialogComponent, {
      header: `Nuevo centro de costo · ${orgNode.name}`,
      width: '78vw',
      style: { 'max-width': '920px' },
      contentStyle: { padding: '1.5rem', overflow: 'auto', 'max-height': '85vh' },
      modal: true,
      dismissableMask: false,
      closable: true,
      styleClass: 'rounded-2xl',
      data: { organizationId: orgNode.location_id, costCenter: null }
    });

    ref.onClose.subscribe(async (result: CostCenterDTO | null | undefined) => {
      if (!result) return;
      try {
        await this.costCenterRegistry.addCostCenter(orgNode.location_id, result);
        this.notify.success(
          'Centro de costo creado',
          `Se agregó "${result.name}" a "${orgNode.name}".`
        );
        await this.reload();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Error desconocido al crear el centro de costo.';
        this.notify.error('No se pudo crear el centro de costo', msg);
      }
    });
  }
}

