import type { InvoiceAiAnalysisResult } from '../use-cases/invoice/types/invoice-ai-analysis.types.js';

/**
 * Driven port: análisis estructurado del texto OCR mediante un LLM.
 *
 * Implementación de referencia: Bedrock Claude Haiku con system prompt
 * por categoría (`BedrockInvoiceAiAnalyzerAdapter`).
 */
export interface IInvoiceAiAnalyzerService {
  analyzeInvoice(rawText: string, category: string): Promise<InvoiceAiAnalysisResult>;
}
