export type StructuredLogContext = {
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly orgId?: string;
  readonly invoiceId?: string;
  readonly state?: string;
  readonly latencyMs?: number;
  readonly [key: string]: string | number | boolean | undefined;
};

/**
 * Logger JSON estructurado para Lambdas (CloudWatch metric filters).
 */
export class StructuredLogger {
  constructor(private readonly service: string) {}

  info(message: string, context: StructuredLogContext = {}): void {
    console.log(JSON.stringify({ level: 'INFO', service: this.service, message, ...context }));
  }

  warn(message: string, context: StructuredLogContext = {}): void {
    console.warn(JSON.stringify({ level: 'WARN', service: this.service, message, ...context }));
  }

  error(message: string, context: StructuredLogContext = {}): void {
    console.error(JSON.stringify({ level: 'ERROR', service: this.service, message, ...context }));
  }
}
