import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type {
  IInvoiceStatusNotifierService,
  InvoiceStatusNotificationInput,
  InvoiceStatusNotificationPayload
} from '@sms/application';

import { InfrastructureConfigError } from '../../../../../exceptions/infrastructure-config.error.js';

const MUTATION = `
  mutation UpdateStatus($id: ID!, $status: String!, $data: AWSJSON, $msg: String) {
    updateInvoiceStatus(id: $id, status: $status, extractedData: $data, message: $msg) {
      id
      status
      extractedData
      message
    }
  }
`.trim();

export type AppSyncInvoiceStatusNotifierAdapterOptions = {
  readonly appsyncUrl?: string;
  readonly apiKey?: string;
};

const normalizePayload = (payload: InvoiceStatusNotificationPayload): string | null => {
  if (payload === null || payload === undefined) {
    return null;
  }
  return JSON.stringify(payload);
};

/**
 * Adapter AppSync: envía la mutación `updateInvoiceStatus` para refrescar
 * la UI vía suscripción GraphQL. Implementa `IInvoiceStatusNotifierService`.
 *
 * El payload se serializa una sola vez (`AWSJSON` de AppSync espera string).
 */
export class AppSyncInvoiceStatusNotifierAdapter implements IInvoiceStatusNotifierService {
  private readonly appsyncUrl: URL;
  private readonly apiKey: string;

  constructor(options: AppSyncInvoiceStatusNotifierAdapterOptions = {}) {
    const url = options.appsyncUrl ?? process.env.APPSYNC_URL;
    const key = options.apiKey ?? process.env.APPSYNC_API_KEY;

    if (!url) {
      throw new InfrastructureConfigError('APPSYNC_URL is not defined');
    }
    if (!key) {
      throw new InfrastructureConfigError('APPSYNC_API_KEY is not defined');
    }

    this.appsyncUrl = new URL(url);
    this.apiKey = key;
  }

  async notifyStatus(input: InvoiceStatusNotificationInput): Promise<void> {
    const variables = {
      id: input.invoiceId,
      status: input.status,
      msg: input.message,
      data: normalizePayload(input.payload ?? null)
    };

    const postBody = JSON.stringify({ query: MUTATION, variables });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: this.appsyncUrl.hostname,
          path: this.appsyncUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey
          }
        },
        (res: IncomingMessage) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw) as { readonly errors?: unknown };
              if (parsed.errors) {
                reject(new Error(`AppSync mutation rejected: ${JSON.stringify(parsed.errors)}`));
                return;
              }
              resolve();
            } catch (parseError) {
              reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
            }
          });
          res.on('error', (err: Error) => reject(err));
        }
      );

      req.on('error', (err: Error) => reject(err));
      req.write(postBody);
      req.end();
    });
  }
}
