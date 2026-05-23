/**
 * Sobre canónico de un evento de dominio destinado al bus integrador
 * (EventBridge / Kafka / NATS).
 *
 * Diseño:
 *  - `payload` es genérico: cada evento define su propio shape (recomendado:
 *    importar `Readonly<MyEventPayload>` desde el dominio y declarar
 *    `IDomainEventPublisher<MyEventPayload>` en el use case).
 *  - `eventName` y `source` permiten ruteo declarativo en el bus.
 *  - `tenantId` viaja como campo de primer nivel para isolation y filtros.
 */
export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  /** Identificador único del evento (UUID); útil para idempotencia downstream. */
  readonly eventId: string;
  /** Nombre canónico del evento, p. ej. `invoice.confirmed.v1`. */
  readonly eventName: string;
  /** ISO-8601 cuando el agregado emitió el evento (no cuando se publicó). */
  readonly occurredAt: string;
  /** Tenant emisor para isolation horizontal del bus. */
  readonly tenantId: string;
  /**
   * Origen del evento (servicio o bounded context, por convención
   * `sms.<context>`, p. ej. `sms.invoices`). EventBridge lo expone como
   * `source` y permite ruteo por reglas.
   */
  readonly source: string;
  /** Payload tipado por el use case que despacha. */
  readonly payload: TPayload;
  /** Datos opcionales para correlación / observabilidad. */
  readonly metadata?: {
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly userId?: string;
  };
}

/**
 * Driven port: publicador de eventos de dominio al bus integrador.
 *
 * Convenciones:
 *  - El método debe ser idempotente desde la perspectiva del adapter cuando
 *    sea posible (deduplicación por `eventId` en EventBridge / Kafka key).
 *  - El use case **no** debe asumir entrega exactly-once; si se requiere,
 *    debe combinarse con outbox pattern en el repositorio.
 */
export interface IDomainEventPublisher {
  publish<TPayload>(event: DomainEventEnvelope<TPayload>): Promise<void>;
}
