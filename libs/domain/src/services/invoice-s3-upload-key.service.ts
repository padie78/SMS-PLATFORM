import { InvoiceUploadKey } from '../value-objects/invoice-upload-key.js';
import { DomainInvariantError } from '../exceptions/domain-invariant.error.js';

/**
 * Decodifica la S3 key y extrae el SK de factura (`INV#…__filename.pdf`).
 * Formato esperado: `uploads/<userId>/INV#UUID__filename.pdf`
 */
export function extractInvoiceMetadataFromS3Key(rawKey: string): InvoiceUploadKey {
  const key = decodeURIComponent(String(rawKey).replace(/\+/g, ' '));
  const fileName = key.split('/').pop();

  if (!fileName || !fileName.includes('__')) {
    throw new DomainInvariantError(`Protocol Violation: Separator '__' not found in key: ${key}`);
  }

  const invoiceSk = fileName.split('__')[0];
  return InvoiceUploadKey.create(invoiceSk, key);
}

/**
 * Construye la S3 key canónica usada por el flujo de upload:
 *   `uploads/{userId}/{invoiceId}__{cleanFileName}`
 *
 * El `invoiceId` se preserva tal cual (puede ser un SK `INV#...`); el
 * `fileName` se normaliza (ASCII / lowercase / sin espacios) y, ante ausencia,
 * se sustituye por un sufijo con timestamp para evitar colisiones.
 */
export function formatInvoiceUploadObjectKey(
  userId: string,
  invoiceId: string,
  fileName?: string | null
): string {
  const safeUser = String(userId ?? '').trim();
  const safeInvoice = String(invoiceId ?? '').trim();

  if (!safeUser) {
    throw new DomainInvariantError('formatInvoiceUploadObjectKey: userId is required');
  }
  if (!safeInvoice) {
    throw new DomainInvariantError('formatInvoiceUploadObjectKey: invoiceId is required');
  }

  if (!fileName || !fileName.trim()) {
    return `uploads/${safeUser}/${safeInvoice}__unnamed_file_${Date.now()}`;
  }

  const cleanFileName = fileName
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();

  return `uploads/${safeUser}/${safeInvoice}__${cleanFileName}`;
}
