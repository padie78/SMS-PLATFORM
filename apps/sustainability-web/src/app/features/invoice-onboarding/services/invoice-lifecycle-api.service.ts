import { Injectable, inject } from '@angular/core';
import type { CommitInvoiceLifecycleInput, EnergyServiceType } from '@sms/common';
import { generateClient } from 'aws-amplify/api';
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
  readonly meta?: {
    readonly invoiceId?: string;
    readonly status?: string;
    readonly version?: number;
    readonly isWip?: boolean;
  };
  readonly latestExtractionDraft?: {
    readonly version?: number;
    readonly overallConfidence?: number;
  } | null;
  readonly goldenRecord?: unknown | null;
}

type GraphqlResult<T> = { data?: T };

@Injectable({ providedIn: 'root' })
export class InvoiceLifecycleApiService {
  private readonly client = generateClient();
  private readonly logger = inject(LoggerService);

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
    const data = await this.executeGraphql<{
      createInvoiceDraft: InvoiceLifecycleMutationResult;
    }>(mutation, { input });
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
    const data = await this.executeGraphql<{
      commitInvoiceLifecycle: InvoiceLifecycleMutationResult;
    }>(mutation, { input });
    const result = data.commitInvoiceLifecycle;
    if (!result?.success) {
      throw new Error(result?.message ?? 'commitInvoiceLifecycle failed');
    }
    return result;
  }

  async getInvoiceLifecycle(invoiceId: string): Promise<InvoiceLifecycleSnapshotResponse | null> {
    const query = `
      query GetInvoiceLifecycle($invoiceId: ID!) {
        getInvoiceLifecycle(invoiceId: $invoiceId)
      }
    `;
    const data = await this.executeGraphql<{ getInvoiceLifecycle: unknown }>(query, { invoiceId });
    const raw = data.getInvoiceLifecycle;
    if (raw == null) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as InvoiceLifecycleSnapshotResponse;
      } catch {
        return null;
      }
    }
    return raw as InvoiceLifecycleSnapshotResponse;
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
