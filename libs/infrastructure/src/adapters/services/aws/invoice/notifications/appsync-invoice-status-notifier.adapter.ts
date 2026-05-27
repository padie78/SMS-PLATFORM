import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
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
  /** Nombre del parámetro SSM con la URL de AppSync (fallback si no se inyecta directo). */
  readonly appsyncUrlSsmParameter?: string;
  /** Nombre del parámetro SSM con la API key (`SecureString`). */
  readonly apiKeySsmParameter?: string;
  /** Región AWS para el cliente SSM (default `process.env.AWS_REGION`). */
  readonly region?: string;
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
 * Resolución de credenciales (en orden):
 *   1. `options.appsyncUrl` / `options.apiKey`.
 *   2. Env vars `APPSYNC_URL` / `APPSYNC_API_KEY`.
 *   3. Parámetros SSM `APPSYNC_URL_SSM_PARAMETER` / `APPSYNC_API_KEY_SSM_PARAMETER`.
 *
 * Esto evita el ciclo Terraform `compute ↔ api`: el worker puede arrancar sin
 * env var directa, leyendo la URL/key del SSM creado por el módulo `api`.
 */
export class AppSyncInvoiceStatusNotifierAdapter implements IInvoiceStatusNotifierService {
  private appsyncUrl: URL | null = null;
  private apiKey: string | null = null;
  private resolved: Promise<void> | null = null;

  private readonly options: AppSyncInvoiceStatusNotifierAdapterOptions;
  private readonly ssm: SSMClient;

  constructor(options: AppSyncInvoiceStatusNotifierAdapterOptions = {}) {
    this.options = options;
    this.ssm = new SSMClient({
      region: options.region ?? process.env.AWS_REGION ?? 'eu-central-1'
    });
  }

  async notifyStatus(input: InvoiceStatusNotificationInput): Promise<void> {
    await this.ensureCredentials();

    const variables = {
      id: input.invoiceId,
      status: input.status,
      msg: input.message,
      data: normalizePayload(input.payload ?? null)
    };

    const postBody = JSON.stringify({ query: MUTATION, variables });
    const url = this.appsyncUrl as URL;
    const apiKey = this.apiKey as string;

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
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

  private async ensureCredentials(): Promise<void> {
    if (this.appsyncUrl && this.apiKey) return;
    if (!this.resolved) {
      this.resolved = this.resolveCredentials();
    }
    await this.resolved;
  }

  private async resolveCredentials(): Promise<void> {
    const url =
      this.options.appsyncUrl ??
      process.env.APPSYNC_URL ??
      (await this.fetchSsm(
        this.options.appsyncUrlSsmParameter ?? process.env.APPSYNC_URL_SSM_PARAMETER,
        false
      ));

    const apiKey =
      this.options.apiKey ??
      process.env.APPSYNC_API_KEY ??
      (await this.fetchSsm(
        this.options.apiKeySsmParameter ?? process.env.APPSYNC_API_KEY_SSM_PARAMETER,
        true
      ));

    if (!url) {
      throw new InfrastructureConfigError(
        'APPSYNC_URL no definido. Configurá APPSYNC_URL o APPSYNC_URL_SSM_PARAMETER.'
      );
    }
    if (!apiKey) {
      throw new InfrastructureConfigError(
        'APPSYNC_API_KEY no definido. Configurá APPSYNC_API_KEY o APPSYNC_API_KEY_SSM_PARAMETER.'
      );
    }

    this.appsyncUrl = new URL(url);
    this.apiKey = apiKey;
  }

  private async fetchSsm(
    parameterName: string | undefined,
    withDecryption: boolean
  ): Promise<string | undefined> {
    if (!parameterName?.trim()) return undefined;
    const res = await this.ssm.send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: withDecryption })
    );
    const value = res.Parameter?.Value;
    return value?.trim() ? value : undefined;
  }
}
