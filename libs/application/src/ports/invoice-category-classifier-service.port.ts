/**
 * Driven port: clasificación temática del documento (ELEC, GAS, LOGISTICS, ...).
 *
 * Implementación de referencia: Bedrock Claude Haiku
 * (`BedrockInvoiceCategoryClassifierAdapter`).
 */
export interface IInvoiceCategoryClassifierService {
  /**
   * Devuelve la categoría detectada. El adaptador debe garantizar un fallback
   * (`OTHERS`) ante fallos transitorios para no bloquear el pipeline.
   */
  classifyCategory(rawText: string): Promise<string>;
}
