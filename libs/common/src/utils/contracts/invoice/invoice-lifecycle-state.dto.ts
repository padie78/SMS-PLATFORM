/**
 * Máquina de estados COMPLETA del ciclo de vida de una `Invoice` desde su
 * registro inicial en frontend hasta su `golden record` final en DynamoDB.
 *
 * Reemplaza/extiende a `InvoiceLifecycleStatusSchema` (legacy, 6 estados) que
 * vive en `invoice-ddb-item.dto.ts`. Ese sigue exportado por compatibilidad
 * con código que aún no migró, pero todo flujo nuevo (FE Wizard + worker +
 * api_lambda invoice resolvers) debe usar `InvoiceLifecycleStateSchema`.
 *
 * Reglas:
 *  - 25 estados nominales agrupados en 5 fases: REGISTRATION, INGESTION,
 *    EXTRACTION, HUMAN_REVIEW, PERSISTENCE.
 *  - Transiciones explícitamente whitelisted (defensa-en-profundidad: el
 *    repositorio escribe con `ConditionExpression` que valida la transición
 *    en DynamoDB y, además, el use case valida en aplicación antes de
 *    intentar la escritura).
 *  - Cualquier estado (excepto terminales) puede caer a `FAILED`.
 *  - `RETRYING` permite re-entrar al flujo desde `FAILED`.
 *
 * Ver §15 de la auditoría inicial para la tabla canónica.
 */
import { z } from 'zod';

export const InvoiceLifecycleStateSchema = z.enum([
  // Fase 1 — Registration (frontend → api_lambda)
  'DRAFT',
  'UPLOADING',
  'UPLOADED',
  'REGISTERING',
  'REGISTERED',
  // Fase 2 — Ingestion (dispatcher → SQS)
  'DISPATCHING',
  'DISPATCHED',
  'QUEUED',
  // Fase 3 — Extraction (worker SQS → Textract → Bedrock)
  'PROCESSING',
  'OCR_COMPLETED',
  'AI_EXTRACTION_COMPLETED',
  'AI_VALIDATION_REQUIRED',
  // Fase 4 — Human review (frontend wizard step crítico)
  'HUMAN_REVIEW_IN_PROGRESS',
  'HUMAN_VALIDATED',
  'HUMAN_CORRECTED',
  // Fase 5 — Persistence (api_lambda confirmInvoiceExtraction)
  'VALIDATING',
  'READY_FOR_PERSISTENCE',
  'PERSISTING',
  'PERSISTED',
  'COMPLETED',
  // Estados transversales
  'RETRYING',
  'PARTIAL_SUCCESS',
  'FAILED',
  'ERROR',
  'DLQ'
]);

export type InvoiceLifecycleState = z.infer<typeof InvoiceLifecycleStateSchema>;

/** Lista en orden lineal (útil para steppers y validaciones de progreso). */
export const INVOICE_LIFECYCLE_STATE_VALUES: readonly InvoiceLifecycleState[] =
  InvoiceLifecycleStateSchema.options;

/**
 * Estados terminales: una vez aquí, sólo se permite transición a `RETRYING`
 * (si el operador o un retry mutation lo dispara) y nada más.
 */
export const TERMINAL_INVOICE_STATES: ReadonlySet<InvoiceLifecycleState> = new Set([
  'COMPLETED',
  'FAILED',
  'ERROR',
  'DLQ'
]);

/** Estados que SON publicados al subscription bus para refrescar la UI. */
export const PUBLISHABLE_INVOICE_STATES: ReadonlySet<InvoiceLifecycleState> = new Set([
  'UPLOADED',
  'REGISTERED',
  'DISPATCHED',
  'PROCESSING',
  'OCR_COMPLETED',
  'AI_EXTRACTION_COMPLETED',
  'AI_VALIDATION_REQUIRED',
  'HUMAN_VALIDATED',
  'HUMAN_CORRECTED',
  'PERSISTING',
  'PERSISTED',
  'COMPLETED',
  'PARTIAL_SUCCESS',
  'FAILED',
  'ERROR'
]);

/**
 * Matriz de transiciones válidas. Una transición `A → B` es válida sii
 * `B ∈ VALID_INVOICE_STATE_TRANSITIONS[A]`.
 *
 * El repositorio DynamoDB hace `ConditionExpression: #status IN (:allowedFrom)`
 * usando estas listas reverse-indexed, y el use case valida en aplicación
 * antes para devolver errores semánticos antes de pagar la latencia DDB.
 */
export const VALID_INVOICE_STATE_TRANSITIONS: Readonly<
  Record<InvoiceLifecycleState, ReadonlyArray<InvoiceLifecycleState>>
> = {
  DRAFT: ['UPLOADING', 'FAILED', 'ERROR'],
  UPLOADING: ['UPLOADED', 'FAILED', 'ERROR'],
  UPLOADED: ['REGISTERING', 'DISPATCHING', 'FAILED', 'ERROR'],
  REGISTERING: ['REGISTERED', 'FAILED', 'ERROR'],
  REGISTERED: ['DISPATCHING', 'FAILED', 'ERROR'],

  DISPATCHING: ['DISPATCHED', 'FAILED', 'ERROR'],
  DISPATCHED: ['QUEUED', 'PROCESSING', 'FAILED', 'ERROR'],
  QUEUED: ['PROCESSING', 'RETRYING', 'DLQ', 'FAILED'],

  PROCESSING: ['OCR_COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'ERROR'],
  OCR_COMPLETED: ['AI_EXTRACTION_COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'],
  AI_EXTRACTION_COMPLETED: ['AI_VALIDATION_REQUIRED', 'FAILED'],
  AI_VALIDATION_REQUIRED: ['HUMAN_REVIEW_IN_PROGRESS', 'FAILED'],

  HUMAN_REVIEW_IN_PROGRESS: [
    'HUMAN_VALIDATED',
    'HUMAN_CORRECTED',
    'FAILED',
    'ERROR'
  ],
  HUMAN_VALIDATED: ['VALIDATING', 'FAILED'],
  HUMAN_CORRECTED: ['VALIDATING', 'FAILED'],

  VALIDATING: ['READY_FOR_PERSISTENCE', 'FAILED'],
  READY_FOR_PERSISTENCE: ['PERSISTING', 'FAILED'],
  PERSISTING: ['PERSISTED', 'FAILED'],
  PERSISTED: ['COMPLETED', 'FAILED'],
  COMPLETED: [],

  RETRYING: ['PROCESSING', 'DISPATCHING', 'FAILED', 'DLQ'],
  PARTIAL_SUCCESS: ['AI_VALIDATION_REQUIRED', 'HUMAN_REVIEW_IN_PROGRESS', 'FAILED'],
  FAILED: ['RETRYING', 'DLQ'],
  ERROR: ['RETRYING'],
  DLQ: ['RETRYING']
} as const;

/** Pregunta defensiva: ¿es legal mover una factura `from → to`? */
export function isValidInvoiceStateTransition(
  from: InvoiceLifecycleState,
  to: InvoiceLifecycleState
): boolean {
  return VALID_INVOICE_STATE_TRANSITIONS[from].includes(to);
}

/**
 * Lista invertida (útil para `ConditionExpression IN`): dado un estado
 * objetivo `to`, qué estados origen son válidos.
 *
 * Calculado a partir de `VALID_INVOICE_STATE_TRANSITIONS` para mantener una
 * única fuente de verdad. NO mutarlo en runtime.
 */
export const ALLOWED_FROM_STATES_FOR: Readonly<
  Record<InvoiceLifecycleState, ReadonlyArray<InvoiceLifecycleState>>
> = (() => {
  const out = {} as Record<InvoiceLifecycleState, InvoiceLifecycleState[]>;
  for (const state of INVOICE_LIFECYCLE_STATE_VALUES) {
    out[state] = [];
  }
  for (const fromState of INVOICE_LIFECYCLE_STATE_VALUES) {
    for (const toState of VALID_INVOICE_STATE_TRANSITIONS[fromState]) {
      out[toState].push(fromState);
    }
  }
  return out;
})();

/** Marca semántica de owner — útil para auditoría y observabilidad. */
export const INVOICE_STATE_OWNER: Readonly<
  Record<InvoiceLifecycleState, 'FE' | 'DISPATCHER' | 'WORKER' | 'API' | 'SQS'>
> = {
  DRAFT: 'FE',
  UPLOADING: 'FE',
  UPLOADED: 'DISPATCHER',
  REGISTERING: 'API',
  REGISTERED: 'API',
  DISPATCHING: 'DISPATCHER',
  DISPATCHED: 'DISPATCHER',
  QUEUED: 'SQS',
  PROCESSING: 'WORKER',
  OCR_COMPLETED: 'WORKER',
  AI_EXTRACTION_COMPLETED: 'WORKER',
  AI_VALIDATION_REQUIRED: 'WORKER',
  HUMAN_REVIEW_IN_PROGRESS: 'FE',
  HUMAN_VALIDATED: 'API',
  HUMAN_CORRECTED: 'API',
  VALIDATING: 'API',
  READY_FOR_PERSISTENCE: 'API',
  PERSISTING: 'API',
  PERSISTED: 'API',
  COMPLETED: 'API',
  RETRYING: 'SQS',
  PARTIAL_SUCCESS: 'WORKER',
  FAILED: 'WORKER',
  ERROR: 'API',
  DLQ: 'SQS'
} as const;
