import {
  PublishDomainEventUseCase,
  type IDomainEventPublisher,
  type PublishDomainEventDeps
} from '@sms/application';

import { EventBridgeDomainEventPublisherAdapter } from '../adapters/services/aws/events/eventbridge-domain-event-publisher.adapter.js';

export interface CreatePublishDomainEventUseCaseParams {
  /** Nombre del Event Bus destino (`EVENT_BUS_NAME`). */
  readonly eventBusName: string | undefined;
  /** Región AWS para el cliente EventBridge. */
  readonly region?: string;
  /** Override del puerto (testing / migración a otro broker). */
  readonly publisher?: IDomainEventPublisher;
  /** Generador de IDs de evento (testing determinista). */
  readonly idGenerator?: PublishDomainEventDeps['idGenerator'];
  /** Reloj inyectable. */
  readonly clock?: PublishDomainEventDeps['clock'];
}

/**
 * Composition root del flujo de publicación de eventos de dominio.
 *
 * Cablea:
 *   - `PublishDomainEventUseCase` (puro)
 *   - `EventBridgeDomainEventPublisherAdapter` (driven adapter)
 *
 * Para flujos de outbox o brokers alternos (Kafka/Kinesis), basta inyectar
 * un `publisher` propio que respete el contrato `IDomainEventPublisher`.
 */
export function createPublishDomainEventUseCase(
  params: CreatePublishDomainEventUseCaseParams
): PublishDomainEventUseCase {
  const publisher: IDomainEventPublisher =
    params.publisher ??
    new EventBridgeDomainEventPublisherAdapter({
      eventBusName: params.eventBusName,
      ...(params.region ? { region: params.region } : {})
    });

  return new PublishDomainEventUseCase({
    publisher,
    ...(params.idGenerator ? { idGenerator: params.idGenerator } : {}),
    ...(params.clock ? { clock: params.clock } : {})
  });
}
