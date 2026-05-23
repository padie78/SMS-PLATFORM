import { ApplicationValidationError } from '../../../exceptions/application-validation.error.js';
import type {
  DomainEventEnvelope,
  IDomainEventPublisher
} from '../../../ports/domain-event-publisher.port.js';
import type {
  PublishDomainEventInputDto,
  PublishDomainEventOutputDto
} from '../../../dtos/events/publish-domain-event/publish-domain-event.dto.js';

export type PublishDomainEventDeps = {
  readonly publisher: IDomainEventPublisher;
  /** Generador de IDs únicos. Inyectable para tests deterministas. */
  readonly idGenerator?: () => string;
  /** Reloj. Inyectable para tests deterministas. */
  readonly clock?: () => string;
};

const NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v\d+$/i;

/**
 * Caso de uso puro: publica un evento de dominio al bus integrador.
 *
 * Coordinación:
 *  1. Valida invariantes mínimas del DTO (nombre con shape `ctx.verb.vN`,
 *     campos obligatorios).
 *  2. Construye un `DomainEventEnvelope` canónico con `eventId` único.
 *  3. Delega en `IDoma
 *  4. Retorna eventId + timestamp para que el caller pueda corrinEventPublisher`.elacionar.
 *
 * NO hace persistencia local (outbox). Si el caller necesita garantía
 * exactly-once, debe combinarlo con un repositorio outbox + un publisher
 * que lea esa tabla.
 */
export class PublishDomainEventUseCase {
  private readonly idGenerator: () => string;
  private readonly clock: () => string;

  constructor(private readonly deps: PublishDomainEventDeps) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  async execute<TPayload>(
    dto: PublishDomainEventInputDto<TPayload>
  ): Promise<PublishDomainEventOutputDto> {
    this.assertNonEmpty(dto.eventName, 'eventName', dto.requestId);
    this.assertNonEmpty(dto.source, 'source', dto.requestId);
    this.assertNonEmpty(dto.tenantId, 'tenantId', dto.requestId);
    this.assertNonEmpty(dto.occurredAt, 'occurredAt', dto.requestId);

    if (!NAME_PATTERN.test(dto.eventName)) {
      throw new ApplicationValidationError(
        `eventName must follow '<context>.<verb>.v<version>' (got "${dto.eventName}", requestId=${dto.requestId})`
      );
    }
    if (dto.payload == null || typeof dto.payload !== 'object') {
      throw new ApplicationValidationError(
        `payload must be a non-null object (requestId=${dto.requestId})`
      );
    }

    const eventId = this.idGenerator();
    const publishedAt = this.clock();

    const envelope: DomainEventEnvelope<TPayload> = {
      eventId,
      eventName: dto.eventName,
      occurredAt: dto.occurredAt,
      tenantId: dto.tenantId,
      source: dto.source,
      payload: dto.payload,
      ...(dto.correlationId || dto.causationId || dto.userId
        ? {
            metadata: {
              ...(dto.correlationId ? { correlationId: dto.correlationId } : {}),
              ...(dto.causationId ? { causationId: dto.causationId } : {}),
              ...(dto.userId ? { userId: dto.userId } : {})
            }
          }
        : {})
    };

    await this.deps.publisher.publish(envelope);

    return { eventId, eventName: dto.eventName, publishedAt };
  }

  private assertNonEmpty(value: string, field: string, requestId: string): void {
    if (!value || !String(value).trim()) {
      throw new ApplicationValidationError(
        `PublishDomainEvent: '${field}' is required (requestId=${requestId})`
      );
    }
  }
}

/**
 * Generador por defecto: prefiere el `crypto.randomUUID` global (Node 20+ y
 * navegadores modernos), cae a `getRandomValues` para construir un UUID
 * RFC-4122 v4 y, si nada está disponible, a un identificador
 * `evt_<ts>_<rand>` (suficiente para tests; no usar en producción).
 *
 * No declara dependencia de `lib.dom` para mantener `@sms/application`
 * neutro al runtime; tipos mínimos vía interface local.
 */
interface MinimalCryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

function defaultIdGenerator(): string {
  const c = (globalThis as { crypto?: MinimalCryptoLike }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
