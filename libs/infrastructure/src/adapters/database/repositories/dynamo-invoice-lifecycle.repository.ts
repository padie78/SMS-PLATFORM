import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb';
import {
  InvoiceVersionConflictError,
  type CommitInvoiceLifecycleStoreInput,
  type InvoiceGoldenRecord,
  type IInvoiceLifecycleRepository,
  type CreateInvoiceLifecycleInput,
  type InvoiceLifecycleIdentity,
  type InvoiceLifecycleSnapshot,
  type InvoiceLifecycleWriteResult,
  type InvoiceStateTransitionInput,
  type PersistExtractionDraftInput,
  type PersistGoldenRecordInput
} from '@sms/application';
import {
  InvoiceLifecycleItemSchema,
  buildInvoiceLookupRefItem,
  buildInvoiceLookupPk,
  buildInvoiceMetaSk,
  buildInvoiceGoldenSk,
  buildInvoicePartitionKey,
  buildLifecycleGsiAttributes,
  computeWipTtl,
  DEFAULT_INVOICE_WIP_TTL_SECONDS,
  type InvoiceAuditEntryItem,
  type InvoiceExtractionDraft,
  InvoiceLookupRefItemSchema,
  type InvoiceLifecycleItem,
  type InvoiceLookupRefItem
} from '@sms/common';
import type { InvoiceDocumentHashLookupResult } from '@sms/application';

export type DynamoInvoiceLifecycleRepositoryOptions = {
  readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;
};

const stripInvPrefix = (sk: string): string => sk.replace(/^INV#/, '').replace(/#META$/, '');

/**
 * Adaptador DynamoDB para el lifecycle v2 de invoices.
 *
 * Implementa optimistic locking (`version`) y transiciones atómicas vía
 * `TransactWriteItems` (META + hijos + AUDIT).
 */
export class DynamoInvoiceLifecycleRepository implements IInvoiceLifecycleRepository {
  constructor(private readonly options: DynamoInvoiceLifecycleRepositoryOptions) {}

  private get doc(): DynamoDBDocumentClient {
    return this.options.doc;
  }

  private get tableName(): string {
    return this.options.tableName;
  }

  /**
   * Workaround defensivo: algunos consumidores/typecheckers pueden quedarse con
   * una versión vieja del tipo `CreateInvoiceLifecycleInput` (sin los campos
   * WIP). En runtime igual pueden venir.
   */
  private asCreateLifecycleInputWithWip(
    input: CreateInvoiceLifecycleInput
  ): CreateInvoiceLifecycleInput & { markAsWip?: boolean; wipTtlSeconds?: number } {
    return input as CreateInvoiceLifecycleInput & {
      markAsWip?: boolean;
      wipTtlSeconds?: number;
    };
  }

  async createLifecycle(input: CreateInvoiceLifecycleInput): Promise<InvoiceLifecycleWriteResult> {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
    const metaSk = buildInvoiceMetaSk(input.invoiceId);

    const inWithWip = this.asCreateLifecycleInputWithWip(input);
    const markAsWip = inWithWip.markAsWip ?? true;
    const wipTtlSeconds = inWithWip.wipTtlSeconds ?? DEFAULT_INVOICE_WIP_TTL_SECONDS;
    const wip = markAsWip
      ? computeWipTtl(nowMs, wipTtlSeconds)
      : { ttl: undefined as number | undefined, expiresAtIso: undefined as string | undefined };

    const item: InvoiceLifecycleItem = InvoiceLifecycleItemSchema.parse({
      PK: pk,
      SK: metaSk,
      invoiceId: input.invoiceId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      status: input.initialStatus,
      version: 0,
      createdAt: now,
      updatedAt: now,
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      ingestionChannel: input.ingestionChannel,
      pointers: {},
      snapshot: {
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        documentHashSha256: input.documentHashSha256,
        branchId: input.branchId,
        buildingId: input.buildingId,
        retryCount: 0
      },
      isWip: markAsWip,
      ttl: wip.ttl,
      wipExpiresAt: wip.expiresAtIso,
      ...buildLifecycleGsiAttributes({
        tenantId: input.tenantId,
        orgId: input.orgId,
        status: input.initialStatus,
        updatedAt: now,
        branchId: input.branchId,
        invoiceId: input.invoiceId
      })
    });

    const lookupRef = buildInvoiceLookupRefItem({
      invoiceId: input.invoiceId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      metaSk,
      createdAt: now
    });

    const transactItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(SK)'
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: lookupRef as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(SK)'
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: input.initialAudit as Record<string, unknown>
        }
      }
    ];

    if (input.documentHashSha256) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            PK: `HASH#${input.documentHashSha256}`,
            SK: 'REF',
            invoiceId: input.invoiceId,
            tenantId: input.tenantId,
            orgId: input.orgId,
            version: 0,
            status: input.initialStatus,
            isWip: markAsWip,
            createdAt: now
          },
          ConditionExpression: 'attribute_not_exists(SK)'
        }
      });
    }

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: transactItems as NonNullable<
            ConstructorParameters<typeof TransactWriteCommand>[0]
          >['TransactItems']
        })
      );

      return {
        invoiceId: input.invoiceId,
        newVersion: 0,
        newState: input.initialStatus,
        updatedAt: now
      };
    } catch (err: unknown) {
      if (this.isConditionalCheckFailed(err)) {
        throw new InvoiceVersionConflictError(input.invoiceId, 0, null);
      }
      throw err;
    }
  }

  async getInvoiceLookupRef(invoiceId: string): Promise<InvoiceLookupRefItem | null> {
    const plainId = stripInvPrefix(invoiceId.replace(/#META$/, ''));
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: buildInvoiceLookupPk(plainId), SK: 'REF' }
      })
    );
    if (!res.Item) return null;
    const parsed = InvoiceLookupRefItemSchema.safeParse(res.Item);
    return parsed.success ? parsed.data : (res.Item as InvoiceLookupRefItem);
  }

  async findActiveByDocumentHash(
    documentHashSha256: string
  ): Promise<InvoiceDocumentHashLookupResult | null> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HASH#${documentHashSha256}`, SK: 'REF' }
      })
    );
    const item = res.Item;
    if (!item || item['isWip'] === false) return null;
    const invoiceId = String(item['invoiceId'] ?? '');
    const tenantId = String(item['tenantId'] ?? '');
    const orgId = String(item['orgId'] ?? '');
    if (!invoiceId || !tenantId || !orgId) return null;
    return {
      invoiceId,
      tenantId,
      orgId,
      version: typeof item['version'] === 'number' ? item['version'] : 0,
      status: String(item['status'] ?? 'DRAFT') as InvoiceDocumentHashLookupResult['status']
    };
  }

  async getLifecycleSnapshot(
    identity: InvoiceLifecycleIdentity
  ): Promise<InvoiceLifecycleSnapshot | null> {
    const pk = buildInvoicePartitionKey(identity.tenantId, identity.orgId);
    const metaSk = buildInvoiceMetaSk(identity.invoiceId);

    let meta = await this.getMetaItem(pk, metaSk);

    // Legacy fallback: skeleton sin #META (dispatcher antiguo).
    if (!meta) {
      const legacySk = `INV#${identity.invoiceId}`;
      meta = await this.getMetaItem(pk, legacySk);
      if (!meta) {
        const legacyPk = identity.orgId.startsWith('ORG#')
          ? identity.orgId.replace('ORG#', '')
          : identity.orgId;
        meta = await this.getMetaItem(legacyPk, legacySk);
      }
    }

    if (!meta) {
      return null;
    }

    const latestExtractionDraft = await this.getLatestExtractionDraft(pk, identity.invoiceId);
    const goldenRecord = await this.getGoldenRecord(pk, identity.invoiceId);

    return { meta, latestExtractionDraft, goldenRecord };
  }

  async transitionState(input: InvoiceStateTransitionInput): Promise<InvoiceLifecycleWriteResult> {
    const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
    const metaSk = buildInvoiceMetaSk(input.invoiceId);
    const now = new Date().toISOString();
    const newVersion = input.expectedVersion + 1;

    const gsi = buildLifecycleGsiAttributes({
      tenantId: input.tenantId,
      orgId: input.orgId,
      status: input.toState,
      updatedAt: now,
      invoiceId: input.invoiceId,
      branchId:
        typeof input.snapshotPatch?.branchId === 'string'
          ? input.snapshotPatch.branchId
          : undefined,
      invoiceDate:
        typeof input.snapshotPatch?.invoiceDate === 'string'
          ? input.snapshotPatch.invoiceDate
          : undefined
    });

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: pk, SK: metaSk },
                UpdateExpression:
                  'SET #st = :to, version = :newVer, updatedAt = :now, ' +
                  'GSI_Status_PK = :gsiPk, GSI_Status_SK = :gsiSk, snapshot = :snap',
                ConditionExpression: this.buildFromStatesCondition(input.allowedFromStates),
                ExpressionAttributeNames: {
                  '#st': 'status',
                  '#ver': 'version'
                },
                ExpressionAttributeValues: {
                  ...this.buildFromStatesValues(input.allowedFromStates, input.expectedVersion),
                  ':to': input.toState,
                  ':newVer': newVersion,
                  ':now': now,
                  ':gsiPk': gsi.GSI_Status_PK,
                  ':gsiSk': gsi.GSI_Status_SK,
                  ':snap': { ...(input.snapshotPatch ?? {}) }
                }
              }
            },
            { Put: { TableName: this.tableName, Item: input.auditEntry as Record<string, unknown> } }
          ]
        })
      );

      return {
        invoiceId: input.invoiceId,
        newVersion,
        newState: input.toState,
        updatedAt: now
      };
    } catch (err: unknown) {
      throw this.mapTransactionError(err, input.invoiceId, input.expectedVersion);
    }
  }

  async persistExtractionDraft(
    input: PersistExtractionDraftInput
  ): Promise<InvoiceLifecycleWriteResult> {
    const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
    const metaSk = buildInvoiceMetaSk(input.invoiceId);
    const now = new Date().toISOString();
    const newVersion = input.expectedVersion + 1;

    const gsi = buildLifecycleGsiAttributes({
      tenantId: input.tenantId,
      orgId: input.orgId,
      status: input.toState,
      updatedAt: now,
      invoiceId: input.invoiceId
    });

    const snapshotPatch = {
      vendor:
        input.extractionDraft.vendor?.name?.value ??
        input.snapshotPatch?.vendor,
      confidenceScore: input.extractionDraft.overallConfidence,
      ...input.snapshotPatch
    };

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: pk, SK: metaSk },
                UpdateExpression:
                  'SET #st = :to, version = :newVer, updatedAt = :now, ' +
                  'pointers.latestExtractionDraftSk = :draftSk, ' +
                  'pointers.latestExtractionDraftVersion = :draftVer, ' +
                  'GSI_Status_PK = :gsiPk, GSI_Status_SK = :gsiSk, snapshot = :snap',
                ConditionExpression: this.buildFromStatesCondition(input.allowedFromStates),
                ExpressionAttributeNames: { '#st': 'status', '#ver': 'version' },
                ExpressionAttributeValues: {
                  ...this.buildFromStatesValues(input.allowedFromStates, input.expectedVersion),
                  ':to': input.toState,
                  ':newVer': newVersion,
                  ':now': now,
                  ':draftSk': input.extractionDraft.SK,
                  ':draftVer': input.extractionDraft.version,
                  ':gsiPk': gsi.GSI_Status_PK,
                  ':gsiSk': gsi.GSI_Status_SK,
                  ':snap': snapshotPatch
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: input.extractionDraft as Record<string, unknown>,
                ConditionExpression: 'attribute_not_exists(SK)'
              }
            },
            { Put: { TableName: this.tableName, Item: input.auditEntry as Record<string, unknown> } }
          ]
        })
      );

      return {
        invoiceId: input.invoiceId,
        newVersion,
        newState: input.toState,
        updatedAt: now
      };
    } catch (err: unknown) {
      throw this.mapTransactionError(err, input.invoiceId, input.expectedVersion);
    }
  }

  async commitLifecycle(
    input: CommitInvoiceLifecycleStoreInput
  ): Promise<InvoiceLifecycleWriteResult> {
    const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
    const metaSk = buildInvoiceMetaSk(input.invoiceId);
    const goldenSk = buildInvoiceGoldenSk(input.invoiceId);
    const now = new Date().toISOString();

    // Si el FE no conoce la versión actual, necesitamos leerla para emitir
    // un newVersion correcto. Es 1 GetItem extra pero acepta concurrencia.
    let baseVersion: number;
    if (input.expectedVersion === null) {
      const current = await this.getMetaItem(pk, metaSk);
      baseVersion = current?.version ?? 0;
    } else {
      baseVersion = input.expectedVersion;
    }
    const newVersion = baseVersion + 1;

    const gsi = buildLifecycleGsiAttributes({
      tenantId: input.tenantId,
      orgId: input.orgId,
      status: input.toState,
      updatedAt: now,
      invoiceId: input.invoiceId,
      branchId:
        typeof input.snapshotPatch?.branchId === 'string'
          ? input.snapshotPatch.branchId
          : undefined,
      invoiceDate:
        typeof input.snapshotPatch?.invoiceDate === 'string'
          ? input.snapshotPatch.invoiceDate
          : undefined
    });

    const goldenItem = {
      ...input.goldenRecord,
      PK: pk,
      SK: goldenSk
    };

    // Condition: status ∈ allowed AND (version == expected OR no se exige).
    const conditionExpression = this.buildCommitCondition(
      input.allowedFromStates,
      input.expectedVersion
    );
    const conditionValues = this.buildCommitValues(
      input.allowedFromStates,
      input.expectedVersion
    );

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: pk, SK: metaSk },
                // Promoción WIP → permanente: REMOVE ttl + SET isWip=false.
                UpdateExpression:
                  'SET #st = :to, version = :newVer, updatedAt = :now, ' +
                  'pointers.goldenRecordSk = :goldenSk, isWip = :false, ' +
                  'GSI_Status_PK = :gsiPk, GSI_Status_SK = :gsiSk, snapshot = :snap ' +
                  'REMOVE #ttl, wipExpiresAt',
                ConditionExpression: conditionExpression,
                ExpressionAttributeNames: {
                  '#st': 'status',
                  '#ver': 'version',
                  '#ttl': 'ttl'
                },
                ExpressionAttributeValues: {
                  ...conditionValues,
                  ':to': input.toState,
                  ':newVer': newVersion,
                  ':now': now,
                  ':goldenSk': goldenSk,
                  ':gsiPk': gsi.GSI_Status_PK,
                  ':gsiSk': gsi.GSI_Status_SK,
                  ':snap': input.snapshotPatch ?? {},
                  ':false': false
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: goldenItem,
                ConditionExpression: 'attribute_not_exists(SK)'
              }
            },
            { Put: { TableName: this.tableName, Item: input.auditEntry as Record<string, unknown> } }
          ]
        })
      );

      return {
        invoiceId: input.invoiceId,
        newVersion,
        newState: input.toState,
        updatedAt: now
      };
    } catch (err: unknown) {
      throw this.mapTransactionError(err, input.invoiceId, baseVersion);
    }
  }

  async persistGoldenRecord(input: PersistGoldenRecordInput): Promise<InvoiceLifecycleWriteResult> {
    const pk = buildInvoicePartitionKey(input.tenantId, input.orgId);
    const metaSk = buildInvoiceMetaSk(input.invoiceId);
    const goldenSk = buildInvoiceGoldenSk(input.invoiceId);
    const now = new Date().toISOString();
    const newVersion = input.expectedVersion + 1;

    const gsi = buildLifecycleGsiAttributes({
      tenantId: input.tenantId,
      orgId: input.orgId,
      status: input.toState,
      updatedAt: now,
      invoiceId: input.invoiceId,
      branchId:
        typeof input.snapshotPatch?.branchId === 'string'
          ? input.snapshotPatch.branchId
          : undefined,
      invoiceDate:
        typeof input.snapshotPatch?.invoiceDate === 'string'
          ? input.snapshotPatch.invoiceDate
          : undefined
    });

    const goldenItem = {
      ...input.goldenRecord,
      PK: pk,
      SK: goldenSk
    };

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: pk, SK: metaSk },
                UpdateExpression:
                  'SET #st = :to, version = :newVer, updatedAt = :now, ' +
                  'pointers.goldenRecordSk = :goldenSk, ' +
                  'GSI_Status_PK = :gsiPk, GSI_Status_SK = :gsiSk, snapshot = :snap',
                ConditionExpression: this.buildFromStatesCondition(input.allowedFromStates),
                ExpressionAttributeNames: { '#st': 'status', '#ver': 'version' },
                ExpressionAttributeValues: {
                  ...this.buildFromStatesValues(input.allowedFromStates, input.expectedVersion),
                  ':to': input.toState,
                  ':newVer': newVersion,
                  ':now': now,
                  ':goldenSk': goldenSk,
                  ':gsiPk': gsi.GSI_Status_PK,
                  ':gsiSk': gsi.GSI_Status_SK,
                  ':snap': input.snapshotPatch ?? {}
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: goldenItem,
                ConditionExpression: 'attribute_not_exists(SK)'
              }
            },
            { Put: { TableName: this.tableName, Item: input.auditEntry as Record<string, unknown> } }
          ]
        })
      );

      return {
        invoiceId: input.invoiceId,
        newVersion,
        newState: input.toState,
        updatedAt: now
      };
    } catch (err: unknown) {
      throw this.mapTransactionError(err, input.invoiceId, input.expectedVersion);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async getMetaItem(pk: string, sk: string): Promise<InvoiceLifecycleItem | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: pk, SK: sk } })
    );
    if (!res.Item) return null;
    const parsed = InvoiceLifecycleItemSchema.safeParse(res.Item);
    if (parsed.success) return parsed.data;
    return this.legacyItemToMeta(res.Item, pk, sk);
  }

  private legacyItemToMeta(
    item: Record<string, unknown>,
    pk: string,
    sk: string
  ): InvoiceLifecycleItem | null {
    const metaStatus =
      item.metadata && typeof item.metadata === 'object'
        ? (item.metadata as { status?: string }).status
        : undefined;
    const status = String(item.status ?? metaStatus ?? 'PROCESSING');
    const invoiceId = stripInvPrefix(sk);
    const now = new Date().toISOString();
    return InvoiceLifecycleItemSchema.parse({
      PK: pk,
      SK: sk.endsWith('#META') ? sk : buildInvoiceMetaSk(invoiceId),
      invoiceId,
      tenantId: 'legacy',
      orgId: pk.replace(/^ORG#/, '').replace(/^TENANT#[^#]+#ORG#/, ''),
      status: status === 'READY_FOR_REVIEW' ? 'AI_VALIDATION_REQUIRED' : 'PROCESSING',
      version: typeof item.version === 'number' ? item.version : 0,
      createdAt: String(
        item.createdAt ??
          (item.metadata && typeof item.metadata === 'object'
            ? (item.metadata as { upload_date?: string }).upload_date
            : undefined) ??
          now
      ),
      updatedAt: String(item.updated_at ?? item.processed_at ?? now),
      s3Bucket: String((item.metadata as { bucket?: string })?.bucket ?? ''),
      s3Key: String((item.metadata as { s3_key?: string })?.s3_key ?? ''),
      pointers: {},
      snapshot: { retryCount: 0 }
    });
  }

  private async getLatestExtractionDraft(
    pk: string,
    invoiceId: string
  ): Promise<InvoiceExtractionDraft | null> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': `INV#${invoiceId}#EXTRACTION#`
        },
        ScanIndexForward: false,
        Limit: 1
      })
    );
    const item = res.Items?.[0];
    if (!item) return null;
    return item as InvoiceExtractionDraft;
  }

  private async getGoldenRecord(
    pk: string,
    invoiceId: string
  ): Promise<InvoiceGoldenRecord | null> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: buildInvoiceGoldenSk(invoiceId) }
      })
    );
    if (!res.Item) {
      // Legacy: golden data may live on the same SK as skeleton.
      return null;
    }
    return res.Item as InvoiceGoldenRecord;
  }

  private async putAuditEntry(entry: InvoiceAuditEntryItem): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: entry as Record<string, unknown>
      })
    );
  }

  private buildFromStatesCondition(
    allowedFrom: ReadonlyArray<string>
  ): string {
    const fromExprs = allowedFrom.map((_, i) => `:from${i}`);
    return `#ver = :expected AND #st IN (${fromExprs.join(', ')})`;
  }

  private buildFromStatesValues(
    allowedFrom: ReadonlyArray<string>,
    expectedVersion: number
  ): Record<string, unknown> {
    const values: Record<string, unknown> = { ':expected': expectedVersion };
    allowedFrom.forEach((state, i) => {
      values[`:from${i}`] = state;
    });
    return values;
  }

  /**
   * Variante para `commitLifecycle`: si `expectedVersion === null` se omite
   * la condición sobre `#ver` y solo se valida el set de estados permitidos.
   */
  private buildCommitCondition(
    allowedFrom: ReadonlyArray<string>,
    expectedVersion: number | null
  ): string {
    const fromExprs = allowedFrom.map((_, i) => `:from${i}`);
    const statesIn = `#st IN (${fromExprs.join(', ')})`;
    if (expectedVersion === null) {
      return statesIn;
    }
    return `#ver = :expected AND ${statesIn}`;
  }

  private buildCommitValues(
    allowedFrom: ReadonlyArray<string>,
    expectedVersion: number | null
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    allowedFrom.forEach((state, i) => {
      values[`:from${i}`] = state;
    });
    if (expectedVersion !== null) {
      values[':expected'] = expectedVersion;
    }
    return values;
  }

  private isConditionalCheckFailed(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'ConditionalCheckFailedException'
    );
  }

  private mapTransactionError(
    err: unknown,
    invoiceId: string,
    expectedVersion: number
  ): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'TransactionCanceledException'
    ) {
      return new InvoiceVersionConflictError(invoiceId, expectedVersion, null);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
