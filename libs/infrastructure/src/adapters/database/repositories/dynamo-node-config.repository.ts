import { randomUUID } from 'node:crypto';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

import type {
  DeleteNodeResult,
  INodeConfigRepository,
  ListNodesFilter,
  NodeConfigItem,
  PartitionContext,
  SaveNodeInput,
  SaveNodeResult,
  SaveOrganizationRootInput,
  SaveOrganizationRootResult,
  UpdateNodePayload,
  UpdateNodeResult
} from '@sms/application';
import {
  appendSegmentToLocationPath,
  buildTenantOrgPartitionKey,
  normalizeOrgScopeSegment,
  normalizeParentIdPointer,
  normalizePartitionSegment,
  normalizeSegmentId
} from '@sms/domain';

const GSI_NODE_PATH = 'GSI_NodePath';

/** Mapea valores GraphQL legacy → tipo canónico. */
function mapIncomingEntityType(nodeType: string | undefined): string {
  const s = String(nodeType ?? '').trim().toUpperCase();
  if (s === 'ORG') return 'ORGANIZATION';
  return s;
}

/** Coerciona el valor `metadata` (GraphQL string|object|null) a objeto plano. */
function coerceMetadataObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/**
 * Implementación DynamoDB de `INodeConfigRepository`. Usa el mismo
 * single-table de la plataforma; PK = `TENANT#…#ORG#…`. Las queries del
 * subtree (`GSI_NodePath`) requieren que el ítem persista `holdingId = PK`.
 *
 * Mantiene el comportamiento del adaptador legacy del `api_lambda` (incluye
 * convivencia con datos antiguos `entity_type = NODE_CONFIG`).
 */
export class DynamoNodeConfigRepository implements INodeConfigRepository {
  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async saveOrganizationRootNode(
    tenantId: string,
    input: SaveOrganizationRootInput
  ): Promise<SaveOrganizationRootResult> {
    const timestamp = new Date().toISOString();
    const raw = input.id ?? input.nodeId;
    const generated = raw ? normalizeSegmentId(raw) : randomUUID().toUpperCase();
    const tSeg = normalizePartitionSegment(tenantId);
    const nSeg = normalizeSegmentId(generated);

    if (!nSeg || !tSeg) {
      return { success: false, message: 'tenantId o nodeId inválido' };
    }
    if (nSeg === tSeg) {
      return {
        success: false,
        message: 'nodeId de organización no puede ser igual al tenantId (holding).'
      };
    }

    const pk = buildTenantOrgPartitionKey(tenantId, nSeg);
    if (!pk) {
      return { success: false, message: 'PK inválida' };
    }

    const sk = `ORGANIZATION#${nSeg}`;
    const path = `#${nSeg}#`;
    const metadata = coerceMetadataObject(input.metadata);

    const item: NodeConfigItem = {
      PK: pk,
      SK: sk,
      holdingId: pk,
      path,
      entityType: 'ORGANIZATION',
      name: input.name,
      parentId: 'ROOT',
      metadata,
      last_updated: timestamp
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        })
      );
    } catch (error) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'ConditionalCheckFailedException') {
        return {
          success: false,
          message: `Colisión: ya existe PK/SK para nodeId=${nSeg}.`
        };
      }
      console.error('Error en saveOrganizationRootNode Put:', error);
      return { success: false, message: err.message ?? 'Unknown DynamoDB error' };
    }

    return { success: true, nodeId: nSeg, path, item };
  }

  async getNode(ctx: PartitionContext, sk: string): Promise<NodeConfigItem | null> {
    try {
      const pk = this.buildPk(ctx);
      if (!pk || !sk) return null;
      const res = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
          ConsistentRead: true
        })
      );
      return (res.Item as NodeConfigItem | undefined) ?? null;
    } catch (error) {
      console.error('Error en getNode:', error);
      return null;
    }
  }

  async saveNode(ctx: PartitionContext, input: SaveNodeInput): Promise<SaveNodeResult> {
    const timestamp = new Date().toISOString();
    const entityType = mapIncomingEntityType(input.nodeType);

    if (entityType === 'ORGANIZATION') {
      return {
        success: false,
        message:
          'Nodo raíz ORGANIZATION: el resolver debe usar saveOrganizationRootNode (nodeId distinto del tenant).'
      };
    }

    const orgSegmentRaw = normalizeOrgScopeSegment(ctx.organizationScopeId);
    if (!orgSegmentRaw) {
      return {
        success: false,
        message:
          'PK: falta orgId en contexto (custom:organization_id, SaveNodeInput.orgId o inferencia).'
      };
    }

    const cleanId = input.id
      ? normalizeSegmentId(input.id)
      : randomUUID().split('-')[0].toUpperCase();
    const sk = `${entityType}#${cleanId}`;
    const parentPointer = normalizeParentIdPointer(input.parentId);

    let finalPath = appendSegmentToLocationPath(undefined, cleanId);
    if (parentPointer && parentPointer !== 'ROOT') {
      const parentNode = await this.getNode(ctx, parentPointer);
      if (parentNode?.path) {
        finalPath = appendSegmentToLocationPath(parentNode.path, cleanId);
      }
    }

    const metadata = coerceMetadataObject(input.metadata);
    const pk = this.buildPk(ctx);
    if (!pk) {
      return {
        success: false,
        message: 'PK inválida: revisa tenant u organización (tenantId + ID org real).'
      };
    }

    const item: NodeConfigItem = {
      PK: pk,
      SK: sk,
      holdingId: pk,
      path: finalPath,
      entityType,
      name: input.name,
      parentId: parentPointer === 'ROOT' ? 'ROOT' : parentPointer,
      metadata,
      last_updated: timestamp
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        })
      );
    } catch (error) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'ConditionalCheckFailedException') {
        return {
          success: false,
          message: `Ya existe un nodo con SK=${sk} en esta partición (duplicado de ID).`
        };
      }
      console.error('Error en saveNode Put:', error);
      return { success: false, message: err.message ?? 'Unknown DynamoDB error' };
    }

    return { success: true, id: sk, path: finalPath, item };
  }

  async updateNode(
    ctx: PartitionContext,
    sk: string,
    updateData: UpdateNodePayload
  ): Promise<UpdateNodeResult> {
    const pk = this.buildPk(ctx);
    const timestamp = new Date().toISOString();

    const entries = Object.entries(updateData).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return { success: false, message: 'No fields to update' };
    }

    const updateExpressions = entries.map((_, i) => `#field${i} = :val${i}`);
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = { ':t': timestamp };
    entries.forEach(([k, v], i) => {
      expressionAttributeNames[`#field${i}`] = k;
      expressionAttributeValues[`:val${i}`] = v;
    });

    try {
      const res = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
          UpdateExpression: `SET ${updateExpressions.join(', ')}, last_updated = :t`,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)'
        })
      );
      return { success: true, data: res.Attributes as NodeConfigItem };
    } catch (error) {
      const err = error as { message?: string };
      console.error('Error en updateNode:', error);
      return { success: false, message: err.message ?? 'Unknown DynamoDB error' };
    }
  }

  async deleteNode(ctx: PartitionContext, sk: string): Promise<DeleteNodeResult> {
    const pk = this.buildPk(ctx);
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)'
        })
      );
      return { success: true };
    } catch (error) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'ConditionalCheckFailedException') {
        return { success: false, message: 'El nodo no existe.' };
      }
      console.error('Error en deleteNode:', error);
      return { success: false, message: err.message ?? 'Unknown DynamoDB error' };
    }
  }

  async listNodes(
    ctx: PartitionContext,
    filter: ListNodesFilter = {}
  ): Promise<NodeConfigItem[]> {
    const pk = this.buildPk(ctx);
    const { underPath, nodeType } = filter;

    const filterExpression =
      '(attribute_exists(#etype)) OR (attribute_exists(#ntype)) OR (#elegacy = :legacy)';
    const baseValues: Record<string, unknown> = { ':legacy': 'NODE_CONFIG' };
    const entityNames: Record<string, string> = {
      '#etype': 'entityType',
      '#ntype': 'nodeType',
      '#elegacy': 'entity_type'
    };

    try {
      let res;
      if (underPath) {
        res = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: GSI_NODE_PATH,
            KeyConditionExpression: 'holdingId = :hid AND begins_with(#pth, :pref)',
            ExpressionAttributeNames: { '#pth': 'path', ...entityNames },
            ExpressionAttributeValues: { ...baseValues, ':hid': pk, ':pref': underPath },
            FilterExpression: filterExpression
          })
        );
      } else {
        res = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeNames: entityNames,
            ExpressionAttributeValues: { ...baseValues, ':pk': pk },
            FilterExpression: filterExpression,
            ConsistentRead: true
          })
        );
      }

      let items = (res.Items as NodeConfigItem[]) ?? [];
      console.log(
        `[listNodes] PK=${pk} underPath=${underPath ?? '(none)'} rawCount=${items.length} table=${this.tableName}`
      );
      if (nodeType) {
        const want = String(nodeType).toUpperCase();
        items = items.filter(
          (i) =>
            (i.entityType && String(i.entityType).toUpperCase() === want) ||
            (i.nodeType && String(i.nodeType).toUpperCase() === want)
        );
      }
      return items;
    } catch (error) {
      console.error('Error en listNodes:', error);
      return [];
    }
  }

  private buildPk(ctx: PartitionContext): string {
    return buildTenantOrgPartitionKey(ctx.tenantId, ctx.organizationScopeId);
  }
}
