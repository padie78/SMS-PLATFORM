import { InvoiceSkSchema, SmsIdSchema } from '@sms/common';
import { z } from 'zod';

import type { InvoiceDispatchQueueMessageDto } from '@sms/application';

/** Validación del payload SQS oficial (`PENDING_WORKER`). */
export const InvoiceDispatchQueueMessageSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  orgId: SmsIdSchema,
  tenantId: z.string().min(1),
  invoiceId: SmsIdSchema,
  sk: InvoiceSkSchema,
  correlationId: z.string().min(1),
  timestamp: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'timestamp must be ISO-parseable'
    }),
  status: z.literal('PENDING_WORKER')
});

export function parseInvoiceDispatchQueueMessage(input: unknown): InvoiceDispatchQueueMessageDto {
  return InvoiceDispatchQueueMessageSchema.parse(input) as InvoiceDispatchQueueMessageDto;
}

export function safeParseInvoiceDispatchQueueMessage(input: unknown) {
  return InvoiceDispatchQueueMessageSchema.safeParse(input);
}
