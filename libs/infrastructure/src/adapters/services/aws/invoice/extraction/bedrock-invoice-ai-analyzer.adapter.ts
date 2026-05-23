import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';
import type {
  IInvoiceAiAnalyzerService,
  InvoiceAiAnalysisResult,
  InvoiceAiEmissionLine
} from '@sms/application';

import { buildBedrockInvoiceSystemPrompt } from './bedrock-invoice-prompt.js';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_TOKENS = 2500;

export type BedrockInvoiceAiAnalyzerAdapterOptions = {
  readonly client?: BedrockRuntimeClient;
  readonly region?: string;
  readonly modelId?: string;
  readonly maxAttempts?: number;
  readonly maxTokens?: number;
};

const numberOrDefault = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Adapter Bedrock: invoca al LLM con el system prompt parametrizado y
 * normaliza tipos numéricos antes de devolver el resultado.
 */
export class BedrockInvoiceAiAnalyzerAdapter implements IInvoiceAiAnalyzerService {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxTokens: number;

  constructor(options: BedrockInvoiceAiAnalyzerAdapterOptions = {}) {
    this.client =
      options.client ??
      new BedrockRuntimeClient({
        region: options.region ?? process.env.AWS_REGION ?? DEFAULT_REGION,
        maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      });
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async analyzeInvoice(rawText: string, category: string): Promise<InvoiceAiAnalysisResult> {
    const systemPrompt = buildBedrockInvoiceSystemPrompt(category);

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze the following OCR text and provide the JSON output following the strict rules provided: \n\nRAW OCR TEXT:\n${rawText}`
            }
          ]
        }
      ]
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
      readonly content?: ReadonlyArray<{ readonly text?: string }>;
    };

    const resultText = responseBody.content?.[0]?.text?.trim();
    if (!resultText) {
      throw new Error('Bedrock response did not contain content text');
    }

    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Bedrock response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error('Bedrock response root is not a JSON object');
    }

    return this.normalizeResult(parsed);
  }

  private normalizeResult(parsed: Record<string, unknown>): InvoiceAiAnalysisResult {
    const result = parsed as InvoiceAiAnalysisResult & Record<string, unknown>;

    if (Array.isArray(parsed.emission_lines)) {
      const normalizedLines: InvoiceAiEmissionLine[] = parsed.emission_lines.map((line) => {
        const lineRecord = isObjectRecord(line) ? line : {};
        const value = numberOrDefault(lineRecord.value, 0);
        const confidence = numberOrDefault(lineRecord.confidence_score, 0);
        return {
          ...(lineRecord as Omit<InvoiceAiEmissionLine, 'value' | 'confidence_score'>),
          value,
          confidence_score: confidence
        };
      });
      (result as { emission_lines?: ReadonlyArray<InvoiceAiEmissionLine> }).emission_lines =
        normalizedLines;
    }

    const sourceData = parsed.source_data;
    if (isObjectRecord(sourceData)) {
      const total = sourceData.total_amount;
      if (isObjectRecord(total) && 'total_with_tax' in total) {
        const normalizedTotal = {
          ...total,
          total_with_tax: numberOrDefault(total.total_with_tax, 0)
        };
        const normalizedSource = { ...sourceData, total_amount: normalizedTotal };
        (result as { source_data?: typeof normalizedSource }).source_data = normalizedSource;
      }
    }

    return result;
  }
}
