import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IS3PresignedUploadUrlService } from '@sms/application';

/**
 * Adaptador AWS para `IS3PresignedUploadUrlService`. Reutilizable por cualquier
 * caso de uso que necesite firmar PUTs (upload de facturas, evidencias, etc.).
 */
export class S3PresignedUploadUrlAdapter implements IS3PresignedUploadUrlService {
  private readonly client: S3Client;

  constructor(params: { region: string; client?: S3Client }) {
    this.client = params.client ?? new S3Client({ region: params.region });
  }

  async presignPutObject(params: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType
    });

    return getSignedUrl(this.client, command, {
      expiresIn: params.expiresInSeconds
    });
  }
}
