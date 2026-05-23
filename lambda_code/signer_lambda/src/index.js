/**
 * Thin entrypoint: Signer Lambda (AppSync resolver — `generateUploadUrl`).
 *
 * Este archivo no instancia casos de uso. Sólo exporta el primary adapter
 * construido por `@sms/infrastructure`, que internamente traduce el evento
 * AppSync al DTO plano y delega en `@sms/application`.
 */
import { createPresignedUploadUrlHandler } from "@sms/infrastructure";

const region = process.env.AWS_REGION || "eu-central-1";
const uploadBucket = process.env.UPLOAD_BUCKET;

export const handler = createPresignedUploadUrlHandler({
  region,
  uploadBucket
});
