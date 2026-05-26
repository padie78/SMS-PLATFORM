import { Injectable, inject } from '@angular/core';
import type { CommitInvoiceLifecycleInput } from '@sms/common';
import { Subscription } from 'rxjs';
import { toInvoiceDynamoId } from '../../../core/models/api/appsync-api.models';
import type { InvoiceReviewView } from '../../../core/models/invoice-review.model';
import {
  InvoiceExtractionParserService,
  mapParsedToExtractionFields
} from '../../../services/business/invoice-extraction-parser.service';
import { AppSyncApiService } from '../../../services/infrastructure/appsync-api.service';
import { S3StorageService } from '../../../services/infrastructure/s3-storage.service';
import { InvoiceStateService } from '../../../services/state/invoice-state.service';
import { WorkflowStateService } from '../../../services/state/workflow-state.service';
import type { InvoiceUpdatedGraphqlEvent, InvoiceUpdatedPayload } from '../../../core/models/api/appsync-api.models';
import {
  AI_READY_STATUSES,
  InvoiceLifecycleApiService,
  type InvoiceLifecycleMutationResult,
  matchesInvoiceSubscription,
  stripInvoiceIdPrefix
} from './invoice-lifecycle-api.service';
import { InvoiceWipStoreService } from './invoice-wip-store.service';

@Injectable({ providedIn: 'root' })
export class InvoiceOnboardingPipelineService {
  private readonly lifecycleApi = inject(InvoiceLifecycleApiService);
  private readonly appsync = inject(AppSyncApiService);
  private readonly s3 = inject(S3StorageService);
  private readonly invoiceState = inject(InvoiceStateService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly wipStore = inject(InvoiceWipStoreService);
  private readonly parser = inject(InvoiceExtractionParserService);

  private aiSubscription: Subscription | null = null;
  private aiBaseline: InvoiceReviewView | null = null;

  tearDown(): void {
    if (this.aiSubscription) {
      this.aiSubscription.unsubscribe();
      this.aiSubscription = null;
    }
    this.aiBaseline = null;
  }

  /**
   * Registra draft en DDB (WIP+TTL), sube PDF a S3 y abre suscripción IA.
   */
  async uploadAndStartPipeline(file: File, isOcr: boolean): Promise<void> {
    this.tearDown();
    this.workflow.resetIdentification();
    this.workflow.setPhase('uploading');

    const documentHashSha256 = await this.sha256Hex(file);
    const draft = await this.lifecycleApi.createInvoiceDraft({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/pdf',
      documentHashSha256
    });

    const invoiceId = stripInvoiceIdPrefix(draft.invoiceId ?? '');
    const dynamoInvoiceId = toInvoiceDynamoId(invoiceId);

    const presigned = await this.appsync.getPresignedUrl(file.name, file.type, dynamoInvoiceId);
    const upload = await this.s3.putObject(presigned.uploadURL, file);
    if (!upload.success) {
      throw new Error('La subida a S3 falló.');
    }

    this.invoiceState.setInvoiceId(invoiceId);
    this.invoiceState.setStorageKey(presigned.key);
    this.invoiceState.setIngestPayload(file);

    this.wipStore.initDraft({
      invoiceId,
      dynamoInvoiceId,
      storageKey: presigned.key,
      metaVersion: draft.version ?? 0,
      isOcr
    });

    this.workflow.setPhase('awaiting_ai');

    if (isOcr) {
      this.subscribeAiUpdates(dynamoInvoiceId);
    } else {
      const empty: InvoiceReviewView = {
        vendor: '',
        invoiceNumber: '',
        invoiceDate: '',
        total: 0,
        currency: 'EUR',
        date: '',
        consumption: 0,
        lines: [],
        confidence: 0
      };
      this.applyExtractedToState(empty);
      this.workflow.setPhase('ready_for_review');
    }
  }

  subscribeAiUpdates(dynamoInvoiceId: string): void {
    this.tearDown();
    this.workflow.setPhase('awaiting_ai');

    const plainId = stripInvoiceIdPrefix(dynamoInvoiceId);
    this.aiSubscription = this.appsync.onInvoiceExtractionCompleted(plainId).subscribe({
      next: (event: InvoiceUpdatedGraphqlEvent) => {
        const payload = this.pickExtractionPayload(event);
        if (!payload?.['invoiceId']) return;
        const status = String(payload['status'] ?? '').toUpperCase();
        if (!AI_READY_STATUSES.has(status) && status !== 'AI_VALIDATION_REQUIRED') {
          return;
        }
        void this.applyExtractionPayload(payload, dynamoInvoiceId);
      },
      error: () => {
        this.workflow.setError('Error en la suscripción de estado de factura.');
      }
    });
  }

  async rejectCurrentInvoice(reason: string): Promise<void> {
    const wip = this.wipStore.getSnapshot();
    if (!wip?.invoiceId) throw new Error('No hay borrador activo.');
    await this.lifecycleApi.rejectInvoice(
      wip.invoiceId,
      reason,
      wip.metaVersion ?? undefined
    );
    this.tearDown();
    this.wipStore.clear();
    this.workflow.setPhase('error');
  }

  async retryCurrentInvoice(reason?: string): Promise<void> {
    const wip = this.wipStore.getSnapshot();
    if (!wip?.invoiceId) throw new Error('No hay borrador activo.');
    await this.lifecycleApi.retryInvoiceProcessing(
      wip.invoiceId,
      wip.metaVersion ?? undefined,
      reason
    );
    this.workflow.setPhase('awaiting_ai');
    this.subscribeAiUpdates(wip.dynamoInvoiceId);
  }

  private async applyExtractionPayload(
    payload: Record<string, unknown>,
    dynamoInvoiceId: string
  ): Promise<void> {
    const extractedData =
      payload['fields'] ?? payload['extractedData'] ?? payload;
    const parsed = this.parser.parse(extractedData);
    const fields = mapParsedToExtractionFields(parsed);

    const review: InvoiceReviewView = {
      vendor: fields.vendor,
      vendorTaxId: fields.vendorTaxId || undefined,
      invoiceNumber: fields.invoiceNumber,
      invoiceDate: fields.invoiceDate ? this.toIsoDate(fields.invoiceDate) : '',
      billingPeriodStart: fields.billingPeriodStart
        ? this.toIsoDate(fields.billingPeriodStart)
        : '',
      billingPeriodEnd: fields.billingPeriodEnd ? this.toIsoDate(fields.billingPeriodEnd) : '',
      total: fields.totalAmount ?? 0,
      consumption: fields.consumptionValue ?? 0,
      currency: 'EUR',
      date: fields.billingPeriodEnd ? this.toIsoDate(fields.billingPeriodEnd) : '',
      lines: [],
      confidence: Number(parsed['confidence_score'] ?? parsed['confidence'] ?? 0.85)
    };

    this.aiBaseline = { ...review };
    this.applyExtractedToState(review);
    this.wipStore.setExtractionMeta({
      warnings: (payload['warnings'] as unknown[]) ?? [],
      suspiciousValues: (payload['suspiciousValues'] as unknown[]) ?? [],
      overallConfidence: Number(payload['overallConfidence'] ?? review.confidence)
    });

    const plainId = stripInvoiceIdPrefix(dynamoInvoiceId);
    const lifecycle = await this.lifecycleApi.getInvoiceLifecycle(plainId);
    if (lifecycle?.meta?.version != null) {
      this.wipStore.setMetaVersion(lifecycle.meta.version);
    }
    const draft = lifecycle?.latestExtractionDraft as { version?: number } | null | undefined;
    if (draft?.version != null) {
      this.wipStore.setExtractionDraftVersion(draft.version);
    }

    this.workflow.setPhase('ready_for_review');
    this.tearDown();
  }

  private applyExtractedToState(review: InvoiceReviewView): void {
    this.invoiceState.patchExtractedOptimistic(review);
    this.wipStore.patchExtracted(review);
    if (review.vendorTaxId) {
      this.wipStore.setVendorTaxId(review.vendorTaxId);
    }
  }

  async fetchWipFromBackend(invoiceId: string): Promise<Record<string, unknown> | null> {
    return this.lifecycleApi.getInvoiceWipSnapshot(invoiceId);
  }

  async commitToBackend(): Promise<InvoiceLifecycleMutationResult> {
    const wip = this.wipStore.getSnapshot();
    const state = this.invoiceState.getSnapshot();
    const extracted = state.extractedData;
    if (!wip?.invoiceId || !extracted) {
      throw new Error('Faltan datos para confirmar la factura.');
    }
    if (!wip.hierarchy.branchId?.trim() || !wip.hierarchy.buildingId?.trim()) {
      throw new Error('Selecciona sucursal y edificio antes de confirmar.');
    }

    const vendorTaxId = (wip.vendorTaxId || extracted.vendorTaxId || 'N/A').trim();
    const invoiceDate =
      extracted.invoiceDate?.trim() ||
      extracted.billingPeriodEnd?.trim() ||
      extracted.date?.trim() ||
      new Date().toISOString().slice(0, 10);

    const billingStart =
      extracted.billingPeriodStart?.trim() || invoiceDate;
    const billingEnd =
      extracted.billingPeriodEnd?.trim() || extracted.date?.trim() || invoiceDate;

    const input: CommitInvoiceLifecycleInput = {
      invoiceId: wip.invoiceId,
      expectedVersion: wip.metaVersion,
      extractionDraftVersion: wip.extractionDraftVersion,
      vendor: extracted.vendor.trim(),
      vendorTaxId,
      invoiceNumber: (extracted.invoiceNumber ?? '').trim() || 'SIN-NUMERO',
      invoiceDate,
      billingPeriodStart: billingStart,
      billingPeriodEnd: billingEnd,
      currency: (extracted.currency ?? 'EUR').slice(0, 3).toUpperCase(),
      totalAmount: Number(extracted.total) || 0,
      taxAmount: extracted.taxAmount,
      subtotalAmount: extracted.netAmount,
      consumptionValue: Number(extracted.consumption) || 0,
      consumptionUnit: 'kWh',
      meterId: wip.hierarchy.meterId || undefined,
      energyType: wip.energyType,
      branchId: wip.hierarchy.branchId,
      buildingId: wip.hierarchy.buildingId,
      costCenterId: wip.hierarchy.costCenterId || undefined,
      assetId: wip.hierarchy.assetId || undefined,
      corrections: (wip.corrections ?? []).map((c) => ({
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        reason: c.reason ?? 'USER_CORRECTION'
      })),
      notes: state.internalNote || undefined,
      wipSnapshotHash: await this.hashUtf8(JSON.stringify(wip))
    };

    this.workflow.setPhase('confirming');
    try {
      const result = await this.lifecycleApi.commitInvoiceLifecycle(input);
      this.wipStore.clear();
      this.workflow.setPhase('confirmed');
      return result;
    } catch (e) {
      this.workflow.setPhase('error');
      throw e;
    }
  }

  private pickExtractionPayload(
    response: InvoiceUpdatedGraphqlEvent
  ): Record<string, unknown> | undefined {
    const root = response as unknown as {
      data?: { onInvoiceExtractionCompleted?: Record<string, unknown> };
      value?: { data?: { onInvoiceExtractionCompleted?: Record<string, unknown> } };
    };
    return (
      root.data?.onInvoiceExtractionCompleted ??
      root.value?.data?.onInvoiceExtractionCompleted
    );
  }

  private pickInvoiceUpdatedPayload(
    response: InvoiceUpdatedGraphqlEvent
  ): InvoiceUpdatedPayload | undefined {
    const root = response as unknown as {
      data?: { onInvoiceUpdated?: InvoiceUpdatedPayload };
      value?: { data?: { onInvoiceUpdated?: InvoiceUpdatedPayload } };
    };
    return (
      root.data?.onInvoiceUpdated ??
      root.value?.data?.onInvoiceUpdated ??
      response.data?.onInvoiceUpdated ??
      response.value?.data?.onInvoiceUpdated
    );
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async sha256Hex(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async hashUtf8(text: string): Promise<string> {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
