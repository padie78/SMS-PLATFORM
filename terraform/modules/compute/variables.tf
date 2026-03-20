# modules/compute/variables.tf

variable "project_name" { type = string }
variable "environment"  { type = string }

variable "lambda_role_arn" {
  description = "ARN del rol de IAM"
  type        = string
}

variable "upload_bucket_arn" {
  description = "ARN del bucket de S3"
  type        = string
}

variable "dynamo_table_name" {
  description = "Nombre de la tabla Dynamo"
  type        = string
}

variable "dynamo_table_arn" {
  description = "ARN de la tabla Dynamo"
  type        = string
}

variable "external_api_url" {
  description = "URL de la API de emisiones"
  type        = string
}

variable "lambda_architecture" {
  description = "Arquitectura (x86_64 o arm64)"
  type        = string
  default     = "arm64"
}

variable "upload_bucket_name" {
  description = "Nombre del bucket de S3"
  type        = string
}

variable "bedrock_model_id" {
  description = "ID del modelo de Bedrock"
  type        = string 
}

variable "emissions_api_url" {
  description = "URL de la API de emisiones"
  type        = string  
} 

variable "emissions_api_key" {
  description = "Clave de la API de emisiones"
  type        = string    
}