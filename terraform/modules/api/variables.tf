# ==============================================================================
# 1. IDENTIFICACIÓN Y ENTORNO
# ==============================================================================
variable "project_name" {
  type        = string
  description = "Nombre base del proyecto"
}

variable "environment" {
  type        = string
  description = "Entorno de despliegue (dev, staging, prod)"
}

# ==============================================================================
# 2. CONEXIÓN CON COMPUTE (Lambdas)
# ==============================================================================
variable "api_lambda_arn" {
  description = "ARN de la Lambda de API/CRUD que procesará las Mutations"
  type        = string
}

variable "signer_lambda_arn" {
  description = "ARN de la lambda que genera las presigned URLs"
  type        = string
}

variable "analytics_lambda_arn" {
  description = "ARN de la Lambda que procesa los eventos de Analytics"
  type        = string
}

variable "kpi_lambda_arn" {
  description = "ARN de la Lambda que procesa los eventos de KPI"
  type        = string
}



# ==============================================================================
# 3. CONEXIÓN CON DATA (DynamoDB)
# ==============================================================================
# NOTA: las variables `dynamo_table_name` / `dynamo_table_arn` fueron retiradas.
# AppSync no accede a DynamoDB directamente; toda I/O pasa por la `api_lambda`
# (que recibe DYNAMO_TABLE en su propio environment desde el módulo compute).


# ==============================================================================
# 4. AUTENTICACIÓN Y REGIÓN
# ==============================================================================
variable "cognito_user_pool_id" {
  description = "ID del User Pool de Cognito para la seguridad de AppSync"
  type        = string
}

variable "cognito_region" {
  description = "Región de AWS donde reside el User Pool"
  type        = string
}

# --- ESTA ES LA QUE TE FALTABA ---
variable "aws_region" {
  description = "Región general de AWS para recursos de logging y X-Ray"
  type        = string
  default     = "eu-central-1"
}

variable "emissions_table_stream_arn" {
  type = string
}

variable "kpi_lambda_role_id" {
  type        = string
  description = "El ID o nombre del rol de la Lambda de KPIs para adjuntar la política de streams"
}

variable "api_lambda_role_id" {
  type        = string
  description = "ID del rol de IAM de la Lambda API"
}

variable "upload_bucket_arn" {
  description = "ARN del bucket de uploads (S3) para permisos de lectura/escritura"
  type        = string
}
