import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsCommandOutput,
  type PutEventsRequestEntry,
  type PutEventsResultEntry
} from '@aws-sdk/client-eventbridge';
import type { DomainEventEnvelope, IDomainEventPublisher } from '@sms/application';

import { InfrastructureConfigError } from '../../../../exceptions/infrastructure-config.error.js';

export type EventBridgeDomainEventPublisherAdapterOptions = {
  /** Nombre del Event Bus destino (`EVENT_BUS_NAME`). `default` si no se provee. */
  readonly eventBusName: string | undefined;
  /** Cliente EventBridge preconfigurado (override en testing). */
  readonly client?: EventBridgeClient;
  /** Región AWS si el cliente no se inyecta. */
  readonly region?: string;
  /**
   * Si se quiere registrar un schema namespace específico para descubrimiento
   * de schemas (Schema Registry), se puede prepender en `DetailType`.
   */
  readonly detailTypePrefix?: string;
};

/**
 * Driven adapter: implementación de `IDomainEventPublisher` sobre AWS
 * EventBridge.
 *
 * Convenciones de mapping:
 *   `Source`      ← `envelope.source`               ej: `sms.invoices`
 *   `DetailType`  ← `envelope.eventName`            ej: `invoice.confirmed.v1`
 *   `Detail`      ← `JSON.stringify(envelope)`      payload completo
 *   `Time`        ← `envelope.occurredAt`           timestamp del agregado
 *
 * El adapter falla rápido si EventBridge reporta `FailedEntryCount > 0`
 * (entrega NO at-most-once: el caller debe poder reintentar de forma segura).
 */
export class EventBridgeDomainEventPublisherAdapter implements IDomainEventPublisher {
  private readonly client: EventBridgeClient;
  private readonly eventBusName: string | undefined;
  private readonly detailTypePrefix?: string;

  constructor(options: EventBridgeDomainEventPublisherAdapterOptions) {
    this.client =
      options.client ??
      new EventBridgeClient(options.region ? { region: options.region } : {});
    this.eventBusName = options.eventBusName;
    this.detailTypePrefix = options.detailTypePrefix;
  }

  async publish<TPayload>(envelope: DomainEventEnvelope<TPayload>): Promise<void> {
    if (!this.eventBusName) {
      throw new InfrastructureConfigError(
        `EVENT_BUS_NAME env var not set. eventName=${envelope.eventName}`
      );
    }

    const detailType = this.detailTypePrefix
      ? `${this.detailTypePrefix}:${envelope.eventName}`
      : envelope.eventName;

    const entry: PutEventsRequestEntry = {
      EventBusName: this.eventBusName,
      Source: envelope.source,
      DetailType: detailType,
      Detail: JSON.stringify(envelope),
      Time: new Date(envelope.occurredAt),
      Resources: [`tenant:${envelope.tenantId}`]
    };

    const out: PutEventsCommandOutput = await this.client.send(
      new PutEventsCommand({ Entries: [entry] })
    );

    if ((out.FailedEntryCount ?? 0) > 0) {
      const first: PutEventsResultEntry | undefined = out.Entries?.[0];
      throw new InfrastructureConfigError(
        `EventBridge PutEvents failed: code=${first?.ErrorCode ?? 'unknown'} message=${first?.ErrorMessage ?? 'no message'} eventId=${envelope.eventId}`
      );
    }
  }
}
