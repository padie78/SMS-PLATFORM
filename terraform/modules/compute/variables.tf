# ==============================================================================
# 1. ROLES DE IAM (Inyectados desde el módulo IAM)
# ==============================================================================
variable "dispatcher_role_arn" {
  description = "ARN del rol para la Lambda Dispatcher"
  type        = string
}

variable "worker_role_arn" {
  description = "ARN del rol para la Lambda Worker (OCR/IA)"
  type        = string
}

variable "api_lambda_role_arn" {
  description = "ARN del rol para la Lambda de API/CRUD"
  type        = string
}

variable "lambda_role_arn" {
  description = "ARN del rol genérico (Signer/KPI)"
  type        = string
}

# ==============================================================================
# 2. INFRAESTRUCTURA Y MENSAJERÍA
# ==============================================================================
variable "sqs_queue_url" {
  description = "URL de la cola SQS de facturas"
  type        = string
}

variable "upload_bucket_name" {
  description = "Nombre del bucket S3 de subidas"
  type        = string
}

variable "upload_bucket_arn" {
  description = "ARN del bucket S3 de subidas"
  type        = string
}

variable "dynamo_table_name" {
  description = "Nombre de la tabla DynamoDB"
  type        = string
}

variable "dynamo_table_arn" {
  description = "ARN de la tabla DynamoDB"
  type        = string
}

# ==============================================================================
# 3. CONFIGURACIÓN GLOBAL Y PROYECTO
# ==============================================================================
variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "lambda_architecture" {
  type    = string
  default = "arm64"
}

variable "allow_tenant_fallback_from_sub" {
  type        = bool
  description = "Si true, la Lambda API define ALLOW_TENANT_FALLBACK_FROM_SUB=true (tenant provisional = sub)."
  default     = false
}

variable "default_organization_scope_id" {
  type        = string
  description = "Opcional: DEFAULT_ORGAN_SCOPE_ID en la Lambda API (getTree/getNode sin orgId ni claim). Misma convención que post_confirmation_default_organization_id."
  default     = ""
}

# ==============================================================================
# 4. INTELIGENCIA ARTIFICIAL Y APIS EXTERNAS
# ==============================================================================
variable "bedrock_model_id" {
  type = string
}

variable "emissions_api_url" {
  type = string
}

variable "emissions_api_key" {
  type      = string
  sensitive = true
}

variable "invoice_queue_arn" {
  description = "ARN de la cola SQS de facturas"
  type        = string
}

variable "appsync_url" {
  description = "URL GraphQL de AppSync (worker notifier → updateInvoiceStatus)"
  type        = string
  default     = ""
}

variable "appsync_api_key" {
  description = "API Key de AppSync para el worker notifier"
  type        = string
  sensitive   = true
  default     = ""
}
