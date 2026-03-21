output "bucket_id" {
  value = module.s3_bucket.s3_bucket_id
}

output "bucket_arn" {
  value = module.s3_bucket.s3_bucket_arn
}

output "frontend_bucket_url" {
  value = aws_s3_bucket_website_configuration.frontend_config.website_endpoint
}

output "bucket_name" {
  value = aws_s3_bucket.upload_bucket.id # El ID en S3 es el nombre del bucket
}