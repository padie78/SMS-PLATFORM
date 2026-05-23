import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';
import type { IInvoiceCategoryClassifierService } from '@sms/application';

import { CATEGORY_RULES, type InvoiceCategoryKey } from './bedrock-invoice-rules.js';

const DEFAULT_REGION = 'eu-central-1';
const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const FALLBACK_CATEGORY: InvoiceCategoryKey = 'OTHERS';
const RAW_TEXT_TRIM_FOR_CLASSIFY = 1500;

const CATEGORY_HINTS: Record<InvoiceCategoryKey, string> = {
  ELEC: 'Electricity, Utility, Luz, Endesa, Iberdrola, kWh, Energía Activa',
  GAS: 'Natural Gas, Gas Natural, Naturgy, m3, kWh Gas',
  LOGISTICS: 'Freight, Transport, Logistics, Envío, Camión, Gasoil A',
  WASTE: 'Waste management, Recycling, Basura, Contenedor',
  WATER: 'Water supply, Agua, Canal Isabel II, m3',
  REFRIGERANTS: 'HVAC, Gas recharge, Aire Acondicionado, R-410A, R-134a',
  FLEET_FUEL: 'Gasoline, Diesel, Repsol, Shell, Fuel for vehicles, Litros',
  BIOMASS: 'Pellets, Wood chips, Biomassa',
  HOTEL: 'Accommodation, Hotel stay, Noches de hotel',
  CLOUDOPS: 'AWS, Azure, Google Cloud, Cloud Services',
  OTHERS: 'General / Unknown'
};

export type BedrockInvoiceCategoryClassifierAdapterOptions = {
  readonly client?: BedrockRuntimeClient;
  readonly region?: string;
  readonly modelId?: string;
};

/**
 * Adapter Bedrock: clasifica el documento en una de las categorías
 * soportadas (`InvoiceCategoryKey`). Ante fallos del modelo, devuelve
 * `OTHERS` para no bloquear el pipeline.
 */
export class BedrockInvoiceCategoryClassifierAdapter
  implements IInvoiceCategoryClassifierService {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(options: BedrockInvoiceCategoryClassifierAdapterOptions = {}) {
    this.client =
      options.client ??
      new BedrockRuntimeClient({
        region: options.region ?? process.env.AWS_REGION ?? DEFAULT_REGION
      });
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
  }

  async classifyCategory(rawText: string): Promise<string> {
    const validKeys = Object.keys(CATEGORY_RULES) as ReadonlyArray<InvoiceCategoryKey>;

    const systemPrompt = `You are a document classifier. Return ONLY the category key from the provided list.\n` +
      `If you see 'kWh' and 'Energía', you MUST return 'ELEC'.\nValid keys: ${validKeys.join(', ')}.\n` +
      `Hints:\n${validKeys.map((k) => `${k}: ${CATEGORY_HINTS[k]}`).join('\n')}`;

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 20,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Classify this invoice text:\n\n${rawText.substring(0, RAW_TEXT_TRIM_FOR_CLASSIFY)}`
            }
          ]
        }
      ]
    };

    try {
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
      const text = responseBody.content?.[0]?.text?.trim().toUpperCase() ?? '';
      return validKeys.find((key) => text.includes(key)) ?? FALLBACK_CATEGORY;
    } catch {
      return FALLBACK_CATEGORY;
    }
  }
}
