/**
 * DTOs del use case `PublishDomainEventUseCase`.
 *
 * El DTO de entrada es deliberadamente genérico (`payload: TPayload`) para que
 * cualquier bounded context pueda reutilizar este caso de uso conservando el
 * tipado fuerte sobre el payload concreto.
 */

export interface PublishDomainEventInputDto<TPayload = Record<string, unknown>> {
  readonly requestId: string;
  /** Nombre canónico del evento: `<context>.<verb>.<version>` */
  readonly eventName: string;
  /** Origen / bounded context emisor. */
  readonly source: string;
  /** Tenant dueño del evento (multitenancy). */
  readonly tenantId: string;
  /** ISO-8601 del momento de ocurrencia (NO de publicación). */
  readonly occurredAt: string;
  /** Payload con tipo declarado por el use case que orquesta. */
  readonly payload: TPayload;
  /** Metadatos opcionales de correlación. */
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly userId?: string;
}

export interface PublishDomainEventOutputDto {
  readonly eventId: string;
  readonly eventName: string;
  readonly publishedAt: string;
}
