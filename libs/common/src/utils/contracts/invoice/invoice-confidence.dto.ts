/**
 * Confidence scoring per-field para la extracción IA.
 *
 * El frontend lo usa para:
 *  - Pintar badges HIGH/MEDIUM/LOW por campo.
 *  - Bloquear el botón "Confirmar" si hay LOW sin tocar.
 *  - Mostrar `rawOcr` (texto crudo detectado por Textract) en tooltip.
 *
 * El worker lo emite tras combinar:
 *  - `ocr_mean_confidence` por field-block de Textract.
 *  - `confidence_score` que el LLM auto-reporta por línea.
 *  - heurísticas de validación (NIF válido, fecha parseable, total != 0…).
 *
 * Mantener este contrato es CRÍTICO para la auditabilidad ESG: cada Golden
 * Record debe poder reproducir cómo se llegó al valor final desde el PDF.
 */
import { z } from 'zod';

/** Umbrales de discretización del score continuo `[0, 1]` → label categórica. */
export const INVOICE_CONFIDENCE_THRESHOLDS = {
  HIGH_MIN: 0.85,
  MEDIUM_MIN: 0.6
} as const;

export const InvoiceConfidenceLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type InvoiceConfidenceLevel = z.infer<typeof InvoiceConfidenceLevelSchema>;

/** Bounding box normalizado Textract (0..1 respecto al ancho/alto de página). */
export const InvoiceBoundingBoxSchema = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1)
  })
  .strict();
export type InvoiceBoundingBox = z.infer<typeof InvoiceBoundingBoxSchema>;

export const InvoiceFieldGeometrySchema = z
  .object({
    page: z.number().int().min(1).default(1),
    boundingBox: InvoiceBoundingBoxSchema
  })
  .strict();
export type InvoiceFieldGeometry = z.infer<typeof InvoiceFieldGeometrySchema>;

export function classifyConfidence(score: number): InvoiceConfidenceLevel {
  if (!Number.isFinite(score)) return 'LOW';
  if (score >= INVOICE_CONFIDENCE_THRESHOLDS.HIGH_MIN) return 'HIGH';
  if (score >= INVOICE_CONFIDENCE_THRESHOLDS.MEDIUM_MIN) return 'MEDIUM';
  return 'LOW';
}

/**
 * Campo escalar con metadatos de confianza.
 *
 * - `value`: representación final (string canónica, ej. "12400" o "2026-04-28").
 * - `numericValue`: opcional cuando el campo es numérico (`total_amount`, etc.).
 * - `confidence`: 0..1.
 * - `level`: derivado (siempre coherente con `confidence`).
 * - `rawOcr`: texto crudo detectado (auditoría — DEBE persistirse).
 */
export const InvoiceConfidenceFieldSchema = z
  .object({
    value: z.string().nullable(),
    numericValue: z.number().finite().nullable().optional(),
    confidence: z.number().min(0).max(1),
    level: InvoiceConfidenceLevelSchema,
    rawOcr: z.string().nullable().optional(),
    /** Posición en el PDF para highlights en el wizard (Textract Geometry). */
    geometry: InvoiceFieldGeometrySchema.optional(),
    /** Marca si el usuario editó el campo (cambia a `false` solo cuando lo IA llenó). */
    userEdited: z.boolean().default(false)
  })
  .refine((f) => f.level === classifyConfidence(f.confidence), {
    message: 'level must match the bucket of confidence (HIGH/MEDIUM/LOW)'
  });
export type InvoiceConfidenceField = z.infer<typeof InvoiceConfidenceFieldSchema>;

/** Helper para construir un ConfidenceField a partir de un score crudo. */
export function buildConfidenceField(input: {
  value: string | null;
  numericValue?: number | null;
  confidence: number;
  rawOcr?: string | null;
  geometry?: InvoiceFieldGeometry;
  userEdited?: boolean;
}): InvoiceConfidenceField {
  const confidence = Math.max(0, Math.min(1, input.confidence));
  return InvoiceConfidenceFieldSchema.parse({
    value: input.value,
    numericValue: input.numericValue,
    confidence,
    level: classifyConfidence(confidence),
    rawOcr: input.rawOcr,
    geometry: input.geometry,
    userEdited: input.userEdited ?? false
  });
}

/** Warning emitido por la IA sobre un campo concreto (ej. fecha fuera de rango). */
export const InvoiceExtractionWarningSchema = z.object({
  code: z.string().min(1),
  field: z.string().min(1),
  message: z.string().min(1),
  /** Sugerencia opcional de corrección. */
  suggestion: z.string().optional()
});
export type InvoiceExtractionWarning = z.infer<typeof InvoiceExtractionWarningSchema>;

/** Valor sospechoso (ej. total = 0, consumo negativo, NIF inválido). */
export const InvoiceSuspiciousValueSchema = z.object({
  field: z.string().min(1),
  value: z.string(),
  reason: z.string().min(1),
  severity: z.enum(['INFO', 'WARN', 'BLOCK']).default('WARN')
});
export type InvoiceSuspiciousValue = z.infer<typeof InvoiceSuspiciousValueSchema>;
