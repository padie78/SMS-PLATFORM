output "upload_bucket_name" { value = module.storage.bucket_id }
output "dynamo_table_name"  { value = module.database.table_name }
output "api_endpoint"       { value = module.compute_api.api_url }