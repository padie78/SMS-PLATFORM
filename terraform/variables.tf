# --- Configuración de AWS ---
variable "aws_region" {
  type        = string
  description = "Región de AWS donde se desplegará la infraestructura"
  default     = "us-east-1"
}

# --- Identificación del Proyecto ---
variable "project_name" {
  type        = string
  description = "Nombre del proyecto (ej: sms-platform)"
  default     = "sms-platform"
}

variable "environment" {
  type        = string
  description = "Entorno de ejecución (dev, stg, prod)"
  default     = "dev"
}

# --- Configuración de Red y Seguridad (CORS) ---
variable "cors_origins" {
  type        = list(string)
  description = "Lista de dominios permitidos para acceder a la API (Angular)"
  default     = ["http://localhost:4200"] # Para desarrollo local
}

# --- Seguridad S3 (Public Access Block) ---

variable "block_public_acls" {
  type        = bool
  default     = true
  description = "Bloquea la creación de nuevos ACLs públicos y elimina los existentes."
}

variable "block_public_policy" {
  type        = bool
  default     = true
  description = "Rechaza políticas de bucket que otorguen acceso público."
}

variable "ignore_public_acls" {
  type        = bool
  default     = true
  description = "Ignora todos los ACLs públicos en el bucket y sus objetos."
}

variable "restrict_public_buckets" {
  type        = bool
  default     = true
  description = "Restringe el acceso a buckets con políticas públicas solo a servicios de AWS y usuarios autorizados."
}

variable "external_api_url" {
  type        = string
  description = "URL de la API externa para obtener datos de sostenibilidad"
  default     = "https://api.sustainability.example.com"  
} # URL de la API externa (puede ser variable para flexibilidad)

variable "lambda_architecture" {
  type        = string
  default     = "arm64"
  description = "Arquitectura de la Lambda (x86_64 o arm64)"
}

variable "auto_deploy" {
  type        = bool
  default     = true
  description = "Determina si se despliega automáticamente la API"
}

# --- Configuración detallada de CORS ---

variable "api_cors_methods" {
  type        = list(string)
  description = "Métodos HTTP permitidos para las peticiones cross-origin (CORS)"
  default     = ["GET", "POST", "OPTIONS", "PUT", "DELETE"]
}

variable "api_cors_headers" {
  type        = list(string)
  description = "Headers permitidos en las peticiones. Vital para Auth y Content-Type"
  default     = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"]
}

variable "api_cors_max_age" {
  type        = number
  description = "Tiempo máximo de vida para las peticiones cross-origin (CORS)"
  default     = 3600
}

variable "query_route_path" {
  type        = string
  description = "Ruta para la función Lambda de consulta"
  default     = "/emissions"
}

variable "signer_route_path" {
  type        = string
  description = "Ruta para la función Lambda de firma"
  default     = "/get-url"
}

# --- Configuración de la Tabla ---
variable "table_name" {
  type        = string
  description = "Nombre de la tabla de DynamoDB. Si no se provee, se genera uno por defecto."
}

variable "billing_mode" {
  type        = string
  default     = "PAY_PER_REQUEST"
  description = "Modo de facturación: PROVISIONED o PAY_PER_REQUEST"
  
  validation {
    condition     = contains(["PROVISIONED", "PAY_PER_REQUEST"], var.billing_mode)
    error_message = "El billing_mode debe ser PROVISIONED o PAY_PER_REQUEST."
  }
}

# --- Time to Live (TTL) ---
variable "enable_ttl" {
  type        = bool
  default     = true
  description = "Indica si se habilita el borrado automático de ítems antiguos"
}

variable "ttl_attribute_name" {
  type        = string
  default     = "ttl"
  description = "Nombre del atributo que contiene el timestamp para el TTL"
}

# --- Tags Globales ---
variable "common_tags" {
  type        = map(string)
  description = "Tags que se aplicarán a todos los recursos"
  default = {
    Project   = "SMS"
    ManagedBy = "Terraform"
    Owner     = "Diego"
  }
}

# variables.tf (RAÍZ)

variable "emissions_api_url" {
  description = "URL de la API externa para cálculo de emisiones"
  type        = string
}

variable "emissions_api_key" {
  description = "API Key para el servicio de emisiones (Mantenela secreta)"
  type        = string
  sensitive   = true # Evita que se vea la clave en los logs del Plan
}

variable "bedrock_model_id" {
  description = "ID del modelo de Amazon Bedrock (ej: Claude 3 Haiku)"
  type        = string
}