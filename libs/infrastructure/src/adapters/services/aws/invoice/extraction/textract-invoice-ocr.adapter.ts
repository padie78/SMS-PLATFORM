import { DetectDocumentTextCommand, TextractClient } from '@aws-sdk/client-textract';
import type { Block } from '@aws-sdk/client-textract';
import type { IInvoiceOcrService } from '@sms/application';

const DEFAULT_REGION = 'eu-central-1';

export type TextractInvoiceOcrAdapterOptions = {
  readonly client?: TextractClient;
  readonly region?: string;
};

/** Adapter Textract: implementa `IInvoiceOcrService` con Detect Document Text. */
export class TextractInvoiceOcrAdapter implements IInvoiceOcrService {
  private readonly client: TextractClient;

  constructor(options: TextractInvoiceOcrAdapterOptions = {}) {
    this.client =
      options.client ??
      new TextractClient({ region: options.region ?? process.env.AWS_REGION ?? DEFAULT_REGION });
  }

  async extractText(bucket: string, key: string): Promise<string> {
    const command = new DetectDocumentTextCommand({
      Document: { S3Object: { Bucket: bucket, Name: key } }
    });

    const response = await this.client.send(command);
    const blocks: ReadonlyArray<Block> = response.Blocks ?? [];

    const rawText = blocks
      .filter((block) => block.BlockType === 'LINE' && typeof block.Text === 'string')
      .map((block) => block.Text as string)
      .join('\n');

    if (!rawText.trim()) {
      throw new Error('Textract returned empty content. Verify the document is not an empty image.');
    }

    return rawText;
  }
}
