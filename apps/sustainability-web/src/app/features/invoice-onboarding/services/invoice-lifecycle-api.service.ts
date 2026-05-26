import { Injectable, inject } from '@angular/core';
import type { CommitInvoiceLifecycleInput, EnergyServiceType } from '@sms/common';
import { generateClient } from 'aws-amplify/api';
import { AuthService } from '../../../services/infrastructure/auth.service';
import { GlobalSettingsService } from '../../../services/state/global-settings.service';
import { LoggerService } from '../../../services/utils/logger.service';

export interface CreateInvoiceDraftApiInput {
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly branchId?: string;
  readonly buildingId?: string;
  readonly documentHashSha256?: string;
}

export interface InvoiceLifecycleMutationResult {
  readonly success: boolean;
  readonly message?: string | null;
  readonly invoiceId?: string | null;
  readonly version?: number | null;
  readonly status?: string | null;
  readonly updatedAt?: string | null;
  readonly correlationId?: string | null;
}

export interface InvoiceLifecycleSnapshotResponse {
  readonly invoiceId?: string;
  readonly status?: string;
  readonly version?: number;
  readonly snapshot?: unknown;
  readonly latestExtractionDraft?: unknown | null;
  readonly goldenRecord?: unknown | null;
  readonly meta?: {
    readonly invoiceId?: string;
    readonly status?: string;
    readonly version?: number;
    readonly isWip?: boolean;
  };
}

type GraphqlResult<T> = { data?: T };

@Injectable({ providedIn: 'root' })
export class InvoiceLifecycleApiService {
  private readonly client = generateClient();
  private readonly logger = inject(LoggerService);
  private readonly auth = inject(AuthService);
  private readonly globalSettings = inject(GlobalSettingsService);

  /**
   * Resuelve un orgId para inyectar en `input.orgId` cuando el token Cognito no trae
   * `custom:organization_id` (api_lambda lo usa vía `mergePartitionContextFromGraphQLArgs`).
   * Prioridad: claim Cognito → `GlobalSettingsService.organizationId`.
   */
  private async resolveOrgIdOverride(): Promise<string | undefined> {
    const fromClaim = await this.auth.getOrganizationIdClaim();
    if (fromClaim) return fromClaim;
    const fromGlobal = this.globalSettings.snapshot().organizationId;
    return fromGlobal?.trim() || undefined;
  }

  async createInvoiceDraft(input: CreateInvoiceDraftApiInput): Promise<InvoiceLifecycleMutationResult> {
    const mutation = `
      mutation CreateInvoiceDraft($input: CreateInvoiceDraftInput!) {
        createInvoiceDraft(input: $input) {
          success
          message
          invoiceId
          version
          status
          updatedAt
          correlationId
        }
      }
    `;
    const orgId = await this.resolveOrgIdOverride();
    const data = await this.executeGraphql<{
      createInvoiceDraft: InvoiceLifecycleMutationResult;
    }>(mutation, { input: { ...input, ...(orgId ? { orgId } : {}) } });
    const result = data.createInvoiceDraft;
    if (!result?.success) {
      throw new Error(result?.message ?? 'createInvoiceDraft failed');
    }
    return result;
  }

  async commitInvoiceLifecycle(
    input: CommitInvoiceLifecycleInput
  ): Promise<InvoiceLifecycleMutationResult> {
    const mutation = `
      mutation CommitInvoiceLifecycle($input: CommitInvoiceLifecycleInput!) {
        commitInvoiceLifecycle(input: $input) {
          success
          message
          invoiceId
          version
          status
          updatedAt
          correlationId
        }
      }
    `;
    const orgId = await this.resolveOrgIdOverride();
    const data = await this.executeGraphql<{
      commitInvoiceLifecycle: InvoiceLifecycleMutationResult;
    }>(mutation, { input: { ...input, ...(orgId ? { orgId } : {}) } });
    const result = data.commitInvoiceLifecycle;
    if (!result?.success) {
      throw new Error(result?.message ?? 'commitInvoiceLifecycle failed');
    }
    return result;
  }

  async rejectInvoice(invoiceId: string, reason: string, expectedVersion?: number): Promise<InvoiceLifecycleMutationResult> {
    const mutation = `
      mutation RejectInvoice($input: RejectInvoiceInput!) {
        rejectInvoice(input: $input) {
          success message invoiceId version status updatedAt
        }
      }
    `;
    const orgId = await this.resolveOrgIdOverride();
    const data = await this.executeGraphql<{ rejectInvoice: InvoiceLifecycleMutationResult }>(mutation, {
      input: { invoiceId, reason, expectedVersion, ...(orgId ? { orgId } : {}) }
    });
    const result = data.rejectInvoice;
    if (!result?.success) throw new Error(result?.message ?? 'rejectInvoice failed');
    return result;
  }

  async retryInvoiceProcessing(
    invoiceId: string,
    expectedVersion?: number,
    reason?: string
  ): Promise<InvoiceLifecycleMutationResult> {
    const mutation = `
      mutation RetryInvoice($input: RetryInvoiceProcessingInput!) {
        retryInvoiceProcessing(input: $input) {
          success message invoiceId version status updatedAt correlationId
        }
      }
    `;
    const orgId = await this.resolveOrgIdOverride();
    const data = await this.executeGraphql<{ retryInvoiceProcessing: InvoiceLifecycleMutationResult }>(
      mutation,
      { input: { invoiceId, expectedVersion, reason, ...(orgId ? { orgId } : {}) } }
    );
    const result = data.retryInvoiceProcessing;
    if (!result?.success) throw new Error(result?.message ?? 'retryInvoiceProcessing failed');
    return result;
  }

  async getInvoiceLifecycle(invoiceId: string): Promise<InvoiceLifecycleSnapshotResponse | null> {
    const query = `
      query GetInvoiceLifecycle($invoiceId: ID!) {
        getInvoiceLifecycle(invoiceId: $invoiceId) {
          invoiceId status version snapshot latestExtractionDraft goldenRecord
        }
      }
    `;
    const data = await this.executeGraphql<{ getInvoiceLifecycle: InvoiceLifecycleSnapshotResponse | null }>(
      query,
      { invoiceId }
    );
    const raw = data.getInvoiceLifecycle;
    if (!raw) return null;
    return {
      meta: {
        invoiceId: raw.invoiceId,
        status: raw.status,
        version: raw.version
      },
      latestExtractionDraft: raw.latestExtractionDraft as InvoiceLifecycleSnapshotResponse['latestExtractionDraft'],
      goldenRecord: raw.goldenRecord
    };
  }

  async getInvoiceWipSnapshot(invoiceId: string): Promise<Record<string, unknown> | null> {
    const query = `
      query GetInvoiceWipSnapshot($invoiceId: ID!) {
        getInvoiceWipSnapshot(invoiceId: $invoiceId) {
          invoiceId version status snapshot latestExtractionDraft wipExpiresAt
        }
      }
    `;
    const data = await this.executeGraphql<{ getInvoiceWipSnapshot: Record<string, unknown> | null }>(query, {
      invoiceId
    });
    return data.getInvoiceWipSnapshot;
  }

  private async executeGraphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    try {
      const raw: unknown = await this.client.graphql(
        variables === undefined
          ? { query, authMode: 'userPool' }
          : { query, variables, authMode: 'userPool' }
      );
      const response = raw as GraphqlResult<T>;
      if (!response.data) {
        throw new Error('GraphQL returned no data payload');
      }
      return response.data;
    } catch (e: unknown) {
      this.logger.error('Invoice lifecycle GraphQL error', e);
      throw e;
    }
  }
}

/** Normaliza IDs con o sin prefijo `INV#`. */
export function stripInvoiceIdPrefix(id: string): string {
  return id.startsWith('INV#') ? id.slice(4) : id;
}

export function matchesInvoiceSubscription(targetDynamoId: string, payloadId: string): boolean {
  return stripInvoiceIdPrefix(targetDynamoId) === stripInvoiceIdPrefix(payloadId);
}

export const AI_READY_STATUSES = new Set([
  'READY_FOR_REVIEW',
  'AI_VALIDATION_REQUIRED',
  'PARTIAL_SUCCESS',
  'HUMAN_REVIEW_IN_PROGRESS'
]);
