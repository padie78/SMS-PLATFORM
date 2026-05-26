/**
 * Item de lookup global para que el dispatcher S3 resuelva tenant/org
 * sin escanear la tabla multi-tenant.
 *
 *   PK = LOOKUP#INV#<invoiceId>
 *   SK = REF
 */
import { z } from 'zod';
import { SmsIdSchema } from '../../validation/schemas/sms-id.schema.js';

export const INVOICE_LOOKUP_PK_PREFIX = 'LOOKUP#INV#';

export const InvoiceLookupRefItemSchema = z
  .object({
    PK: z.string().regex(/^LOOKUP#INV#[^\s/]+$/),
    SK: z.literal('REF'),
    invoiceId: SmsIdSchema,
    tenantId: z.string().min(1),
    orgId: z.string().min(1),
    metaSk: z.string().min(1),
    createdAt: z.string().min(1)
  })
  .strict();

export type InvoiceLookupRefItem = z.infer<typeof InvoiceLookupRefItemSchema>;

export function buildInvoiceLookupPk(invoiceId: string): string {
  const id = invoiceId.startsWith('INV#') ? invoiceId.slice(4) : invoiceId;
  return `${INVOICE_LOOKUP_PK_PREFIX}${id}`;
}

export function buildInvoiceLookupRefItem(input: {
  invoiceId: string;
  tenantId: string;
  orgId: string;
  metaSk: string;
  createdAt: string;
}): InvoiceLookupRefItem {
  const plainId = input.invoiceId.startsWith('INV#') ? input.invoiceId.slice(4) : input.invoiceId;
  return InvoiceLookupRefItemSchema.parse({
    PK: buildInvoiceLookupPk(plainId),
    SK: 'REF',
    invoiceId: plainId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    metaSk: input.metaSk,
    createdAt: input.createdAt
  });
}
