# ==============================================================================
# 1. SEGURIDAD E IDENTIDAD (Cimientos)
# ==============================================================================
module "iam" {
  source           = "./modules/iam"
  project_name     = var.project_name
  environment      = var.environment
  dynamo_table_arn = module.database.table_arn

  invoice_queue_arn = module.invoice_process_queue.arn
  invoice_queue_url = module.invoice_process_queue.url

}

module "auth" {
  source                                    = "./modules/auth"
  project_name                              = var.project_name
  environment                               = var.environment
  post_confirmation_default_organization_id = var.post_confirmation_default_organization_id
}

# ==============================================================================
# 2. PERSISTENCIA Y ALMACENAMIENTO (Data Layer)
# ==============================================================================
module "storage" {
  source       = "./modules/storage"
  project_name = var.project_name
  environment  = var.environment

  versioning_enabled      = false
  cors_allowed_origins    = var.cors_origins
  block_public_acls       = var.block_public_acls
  block_public_policy     = var.block_public_policy
  ignore_public_acls      = var.ignore_public_acls
  restrict_public_buckets = var.restrict_public_buckets

  # Trigger de la Lambda de procesamiento al subir archivos
  dispatcher_lambda_arn  = module.compute.dispatcher_lambda_arn
  dispatcher_lambda_name = module.compute.dispatcher_lambda_name
}

module "database" {
  source             = "./modules/database"
  project_name       = var.project_name
  environment        = var.environment
  table_name         = local.table_name
  billing_mode       = var.billing_mode
  enable_ttl         = var.enable_ttl
  ttl_attribute_name = var.ttl_attribute_name
}

# ==============================================================================
# 3. CÓMPUTO (Lógica de Negocio / IA)
# ==============================================================================
# main.tf (Raíz)

module "compute" {
  source       = "./modules/compute"
  project_name = var.project_name
  environment  = var.environment

  # 1. Roles inyectados desde el módulo IAM
  dispatcher_role_arn = module.iam.dispatcher_lambda_role_arn
  worker_role_arn     = module.iam.worker_lambda_role_arn
  lambda_role_arn     = module.iam.lambda_role_arn
  api_lambda_role_arn = module.iam.api_lambda_role_arn

  # 2. Variable de SQS inyectada desde el módulo SQS
  sqs_queue_url = module.invoice_process_queue.url

  # 3. Conexión S3 y Dynamo (Nombres y ARNs)
  upload_bucket_name = module.storage.bucket_name
  upload_bucket_arn  = module.storage.bucket_arn # REPARADO: Se agregó el ARN
  dynamo_table_name  = module.database.table_name
  dynamo_table_arn   = module.database.table_arn # REPARADO: Se agregó el ARN
  invoice_queue_arn  = module.invoice_process_queue.invoice_queue_arn

  # 4. IA y APIs
  bedrock_model_id    = var.bedrock_model_id
  emissions_api_url   = var.emissions_api_url
  emissions_api_key   = var.emissions_api_key
  lambda_architecture = var.lambda_architecture

  allow_tenant_fallback_from_sub = var.api_lambda_allow_tenant_fallback_from_sub != null ? var.api_lambda_allow_tenant_fallback_from_sub : contains(["dev", "development", "local"], lower(var.environment))

  allow_tenant_as_org_fallback = var.api_lambda_allow_tenant_as_org_fallback != null ? var.api_lambda_allow_tenant_as_org_fallback : contains(["dev", "development", "local"], lower(var.environment))

  default_organization_scope_id = var.post_confirmation_default_organization_id
}

# ==============================================================================
# 4. ORQUESTACIÓN DE DATOS (GraphQL Hub con AppSync)
# ==============================================================================
module "api" {
  source       = "./modules/api" # Tu nuevo módulo AppSync
  project_name = var.project_name
  environment  = var.environment

  # Lambdas conectadas (Signer y CRUD)
  signer_lambda_arn          = module.compute.signer_lambda_arn
  api_lambda_arn             = module.compute.api_lambda_arn
  analytics_lambda_arn       = module.compute.analytics_lambda_arn
  kpi_lambda_arn             = module.compute.kpi_lambda_arn
  emissions_table_stream_arn = module.database.table_stream_arn
  kpi_lambda_role_id         = module.iam.lambda_role_name
  api_lambda_role_id         = module.iam.api_lambda_role_name # <--- Cambialo aquí

  # Persistencia
  # NOTA: dynamo_* removidos del módulo api — AppSync solo invoca Lambdas, no Dynamo.
  upload_bucket_arn = module.storage.bucket_arn

  # Seguridad Cognito
  cognito_user_pool_id = module.auth.user_pool_id
  cognito_region       = var.aws_region
}

module "invoice_process_dlq" {
  source = "./modules/sqs"
  name   = "${var.project_name}-invoice-dlq-${var.environment}"
  tags   = { Environment = var.environment, Service = "billing" }
}

module "invoice_process_queue" {
  source  = "./modules/sqs"
  name    = "${var.project_name}-invoice-queue-${var.environment}"
  dlq_arn = module.invoice_process_dlq.arn
  tags    = { Environment = var.environment, Service = "billing" }
}

# ==============================================================================
# 6. FRONTEND HOSTING (S3 + CloudFront OAC)
# ==============================================================================
module "frontend_storage" {
  source = "./modules/frontend"

  project_name = var.project_name
  environment  = var.environment

  appsync_url    = module.api.appsync_url
  appsync_region = var.aws_region
  user_pool_id   = module.auth.user_pool_id
  client_id      = module.auth.client_id
}

module "frontend_cdn" {
  source = "./modules/cloudfront"

  project_name = var.project_name
  environment  = var.environment

  bucket_name                 = module.frontend_storage.bucket_id
  bucket_regional_domain_name = module.frontend_storage.bucket_regional_domain_name

  tags = {
    Project     = "SMS"
    Environment = var.environment
  }
}

# Política S3 en la raíz (evita ciclo módulo↔CDN y ARN vacío en SourceArn)
resource "aws_s3_bucket_policy" "webapp_cloudfront_oac" {
  bucket = module.frontend_storage.bucket_id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipalReadOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${module.frontend_storage.bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = module.frontend_cdn.cloudfront_arn
          }
        }
      }
    ]
  })

  depends_on = [
    module.frontend_storage,
    module.frontend_cdn
  ]
}

# Si el bucket ya existe en AWS y querés importarlo (opcional):
#   terraform import module.frontend_storage.aws_s3_bucket.webapp_bucket sms-platform-dev-webapp-hosting
# No uses bloques `import {}` si el bucket fue borrado: Terraform no lo recrea y fallan los recursos hijos.