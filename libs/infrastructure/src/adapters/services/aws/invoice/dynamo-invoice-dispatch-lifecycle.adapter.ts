import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  type InvoiceLifecycleState
} from '@sms/common';
import type { InvoiceDispatchLifecyclePort, InvoiceDispatchLifecycleResult } from '@sms/application';

import { DynamoInvoiceLifecycleRepository } from '../../../database/repositories/dynamo-invoice-lifecycle.repository.js';

const stripInvPrefix = (sk: string): string => (sk.startsWith('INV#') ? sk.slice(4) : sk);

/**
 * Dispatcher S3 → lifecycle v2: resuelve lookup, marca UPLOADED y DISPATCHED.
 */
export class DynamoInvoiceDispatchLifecycleAdapter implements InvoiceDispatchLifecyclePort {
  private readonly repo: DynamoInvoiceLifecycleRepository;

  constructor(doc: DynamoDBDocumentClient, tableName: string) {
    this.repo = new DynamoInvoiceLifecycleRepository({ doc, tableName });
  }

  async onInvoiceUploaded(params: {
    invoiceSk: string;
    bucket: string;
    key: string;
    requestId: string;
  }): Promise<InvoiceDispatchLifecycleResult> {
    const invoiceId = stripInvPrefix(params.invoiceSk);
    const lookup = await this.repo.getInvoiceLookupRef(invoiceId);
    if (!lookup) {
      throw new Error(
        `Invoice lookup not found for ${invoiceId}. Ensure createInvoiceDraft ran before S3 upload.`
      );
    }

    const identity = {
      tenantId: lookup.tenantId,
      orgId: lookup.orgId,
      invoiceId: lookup.invoiceId
    };

    const snapshot = await this.repo.getLifecycleSnapshot(identity);
    const currentVersion = snapshot?.meta.version ?? 0;
    const currentStatus = snapshot?.meta.status ?? 'DRAFT';
    const pk = buildInvoicePartitionKey(lookup.tenantId, lookup.orgId);
    const now = new Date().toISOString();

    let version = currentVersion;
    let status: InvoiceLifecycleState = currentStatus;

    const transition = async (
      allowedFrom: ReadonlyArray<InvoiceLifecycleState>,
      to: InvoiceLifecycleState,
      details: string
    ): Promise<void> => {
      const auditEntry = buildAuditEntryItem({
        pk,
        invoiceId: lookup.invoiceId,
        timestamp: now,
        event: 'STATE_TRANSITION',
        actor: { type: 'SYSTEM_DISPATCHER', pipelineRunId: params.requestId },
        fromStatus: status,
        toStatus: to,
        resultingVersion: version + 1,
        details,
        metadata: { correlationId: params.requestId, s3Key: params.key, bucket: params.bucket }
      });
      const result = await this.repo.transitionState({
        ...identity,
        expectedVersion: version,
        allowedFromStates: allowedFrom,
        toState: to,
        auditEntry,
        snapshotPatch: { s3Bucket: params.bucket, s3Key: params.key }
      });
      version = result.newVersion;
      status = result.newState;
    };

    if (['DRAFT', 'UPLOADING'].includes(status)) {
      await transition(['DRAFT', 'UPLOADING'], 'UPLOADED', 'S3 object created');
    }
    if (!['DISPATCHED', 'QUEUED', 'PROCESSING', 'AI_VALIDATION_REQUIRED', 'PERSISTED', 'COMPLETED'].includes(status)) {
      await transition(
        ['UPLOADED', 'REGISTERED', 'DRAFT', 'UPLOADING'],
        'DISPATCHED',
        'Enqueued for worker processing'
      );
    }

    return {
      tenantId: lookup.tenantId,
      orgId: lookup.orgId,
      invoiceId: lookup.invoiceId,
      version,
      status
    };
  }
}
