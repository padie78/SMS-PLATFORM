provider "aws" {
  region = var.aws_region
}

# Este es el "module.iam" al que haces referencia
module "iam" {
  source       = "./modules/iam"
  project_name = var.project_name
  environment  = var.environment
}

module "auth" {
  source       = "./modules/auth"
  project_name = var.project_name
  environment  = var.environment
}

# Llamamos al módulo de Storage
module "storage" {
  source       = "./modules/storage"
  project_name = var.project_name
  environment  = var.environment

  # Versionado
  versioning_enabled = false

  # CORS
  cors_allowed_origins = var.cors_origins

  # Seguridad (bloqueo público)
  block_public_acls       = var.block_public_acls
  block_public_policy     = var.block_public_policy
  ignore_public_acls      = var.ignore_public_acls
  restrict_public_buckets = var.restrict_public_buckets
}


# Llamamos al módulo de Database
module "database" {
  source             = "./modules/database"
  project_name       = var.project_name
  environment        = var.environment
  table_name         = local.table_name  # nombre personalizado
  billing_mode       = var.billing_mode  # default
  enable_ttl         = var.enable_ttl    # default
  ttl_attribute_name = var.ttl_attribute_name # default
}


# 1. Módulo de Cómputo: Define las funciones Lambda
module "compute" {
  source       = "./modules/compute"
  project_name = var.project_name
  environment  = var.environment
  
  # Seguridad: El rol que creamos en el módulo IAM
  lambda_role_arn = module.iam.lambda_role_arn

  # Infraestructura: Conexión con Storage y Database
  upload_bucket_arn = module.storage.bucket_arn
  upload_bucket_name = module.storage.bucket_name # <-- Usá .name o .id, no .arn

  dynamo_table_name = module.database.table_name
  dynamo_table_arn  = module.database.table_arn

  # Configuración externa (puedes sacarla de var o hardcodearla)
  external_api_url  = var.external_api_url # Mejor usar variable para flexibilidad
  
  # Opcionales: Si no los pasas, usa los defaults (arm64, nodejs20, etc)
  lambda_architecture = var.lambda_architecture 

  emissions_api_key = var.emissions_api_key
  emissions_api_url = var.emissions_api_url
  bedrock_model_id  = var.bedrock_model_id
}


# 2. Módulo de Infraestructura API: Crea el "Edificio" (Gateway + Stage)
# --- Módulo de Infraestructura de API ---
module "compute_api" {
  source       = "./modules/compute_api"
  
  # Identificación (Vienen de tus variables globales)
  project_name = var.project_name
  environment  = var.environment

  # Configuración de la API
  auto_deploy     = var.auto_deploy

  # Configuración de CORS (Pasamos la lista definida en terraform.tfvars)
  api_cors_origins = var.cors_origins
  api_cors_methods = var.api_cors_methods
  api_cors_headers = var.api_cors_headers
  api_cors_max_age = var.api_cors_max_age

  # Seguridad: Pasamos el ARN generado por el módulo IAM
  lambda_role_arn  = module.iam.lambda_role_arn
}

# 3. Módulo de Rutas: Conecta las Lambdas con el Gateway
module "api" {
  source            = "./modules/api"
  project_name      = var.project_name
  environment       = var.environment

  # Conexión con Cognito
  cognito_user_pool_arn = module.auth.user_pool_arn
  cognito_client_id     = module.auth.client_id
  cognito_endpoint      = module.auth.user_pool_endpoint
  
  # Infraestructura API
  api_id            = module.compute_api.api_id
  api_execution_arn = module.compute_api.api_execution_arn
  
  # Lambdas
  query_lambda_arn   = module.compute.query_lambda_arn
  query_lambda_name  = module.compute.query_lambda_name
  signer_lambda_arn  = module.compute.signer_lambda_arn
  signer_lambda_name = module.compute.signer_lambda_name
  lambda_role_arn  = module.iam.lambda_role_arn

  # Paths
  query_route_path  = var.query_route_path
  signer_route_path = var.signer_route_path 
}