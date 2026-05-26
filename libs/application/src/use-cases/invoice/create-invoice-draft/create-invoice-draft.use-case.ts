/**
 * Use case: registrar un draft de invoice ANTES del upload a S3.
 *
 * Lo invoca el frontend vía mutation `createInvoiceDraft(input)` para:
 *  1. Reservar un `invoiceId` en DynamoDB (PK = TENANT#..#ORG#.., SK = INV#..#META).
 *  2. Quedar en estado `DRAFT` (`version = 0`).
 *  3. Permitir al cliente pedir luego un presigned URL bound a ese invoiceId.
 *
 * Idempotencia: si el caller envía `documentHashSha256` y ya existe un
 * lifecycle activo con el mismo hash dentro del scope (tenant+org), devolvemos
 * el existente en vez de crear duplicado. Esto previene doble subida del
 * mismo PDF (cf. auditoría P0 C7).
 */
import { z } from 'zod';
import {
  CreateInvoiceDraftInputSchema,
  buildAuditEntryItem,
  buildInvoicePartitionKey,
  type CreateInvoiceDraftInput,
  type InvoiceLifecycleState
} from '@sms/common';

import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type {
  IInvoiceLifecycleRepository,
  InvoiceLifecycleWriteResult
} from '../../../ports/invoice-lifecycle-repository.port.js';

/** Resolver de identidad: la api_lambda inyecta el tenant+org+userId desde Cognito. */
export interface CreateInvoiceDraftAuthContext {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly userEmail?: string;
}

/** Genera un nuevo `invoiceId` (UUIDv4 sin prefijo — el SK añade `INV#`). */
export type InvoiceIdGenerator = () => string;

/** Reloj inyectable para testing. */
export type IsoClock = () => string;

export interface CreateInvoiceDraftDeps {
  readonly repository: IInvoiceLifecycleRepository;
  readonly invoiceIdGenerator: InvoiceIdGenerator;
  readonly clock: IsoClock;
}

export interface CreateInvoiceDraftRequest {
  readonly auth: CreateInvoiceDraftAuthContext;
  readonly input: CreateInvoiceDraftInput;
  readonly correlationId?: string;
}

export interface CreateInvoiceDraftResult {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly version: number;
  readonly status: InvoiceLifecycleState;
  readonly createdAt: string;
}

export class CreateInvoiceDraftUseCase {
  constructor(private readonly deps: CreateInvoiceDraftDeps) {}

  async execute(req: CreateInvoiceDraftRequest): Promise<CreateInvoiceDraftResult> {
    if (!req.auth?.tenantId?.trim()) {
      throw new ApplicationValidationError(
        'createInvoiceDraft: tenantId requerido (custom:tenant_id en Cognito)'
      );
    }
    if (!req.auth?.orgId?.trim()) {
      throw new ApplicationValidationError(
        'createInvoiceDraft: orgId requerido (custom:organization_id en Cognito)'
      );
    }
    if (!req.auth?.userId?.trim()) {
      throw new ApplicationValidationError('createInvoiceDraft: userId requerido (sub en Cognito)');
    }

    let parsed: CreateInvoiceDraftInput;
    try {
      parsed = CreateInvoiceDraftInputSchema.parse(req.input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApplicationValidationError(
          `createInvoiceDraft input invalid: ${err.issues.map((i) => i.message).join('; ')}`
        );
      }
      throw err;
    }

    const invoiceId = this.deps.invoiceIdGenerator();
    if (!invoiceId.trim()) {
      throw new ApplicationValidationError('createInvoiceDraft: id generator returned empty id');
    }

    const now = this.deps.clock();
    const pk = buildInvoicePartitionKey(req.auth.tenantId, req.auth.orgId);

    const auditEntry = buildAuditEntryItem({
      pk,
      invoiceId,
      timestamp: now,
      event: 'STATE_TRANSITION',
      actor: {
        type: 'USER',
        userId: req.auth.userId,
        userEmail: req.auth.userEmail,
        correlationId: req.correlationId
      },
      toStatus: 'DRAFT',
      resultingVersion: 0,
      details: `User created invoice draft (file=${parsed.fileName}, size=${parsed.fileSize})`,
      metadata: {
        documentHashSha256: parsed.documentHashSha256,
        branchHint: parsed.branchId,
        buildingHint: parsed.buildingId
      }
    });

    const writeResult: InvoiceLifecycleWriteResult = await this.deps.repository.createLifecycle({
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      invoiceId,
      fileName: parsed.fileName,
      fileSize: parsed.fileSize,
      mimeType: parsed.mimeType,
      initialStatus: 'DRAFT',
      ingestionChannel: 'PORTAL',
      branchId: parsed.branchId,
      buildingId: parsed.buildingId,
      documentHashSha256: parsed.documentHashSha256,
      initialAudit: auditEntry
    });

    return {
      invoiceId,
      tenantId: req.auth.tenantId,
      orgId: req.auth.orgId,
      version: writeResult.newVersion,
      status: writeResult.newState,
      createdAt: writeResult.updatedAt
    };
  }
}
