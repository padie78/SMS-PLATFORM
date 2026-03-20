variable "project_name" { type = string }
variable "environment"  { type = string }

# Datos del API Gateway (Vienen de compute_api)
variable "api_id"            { type = string }
variable "api_execution_arn" { type = string }

# Datos de Cognito (Vienen de auth)
variable "cognito_user_pool_arn" { type = string }
variable "cognito_client_id"     { type = string }
variable "cognito_endpoint"      { type = string }

# Datos de las Lambdas (Vienen de compute)
variable "query_lambda_arn"   { type = string }
variable "query_lambda_name"  { type = string }
variable "signer_lambda_arn"  { type = string }
variable "signer_lambda_name" { type = string }

# Paths de las rutas
variable "query_route_path"  { type = string }
variable "signer_route_path" { type = string }