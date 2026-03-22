# --- Identificación del Proyecto ---
variable "project_name" {
  type        = string
  description = "Nombre del proyecto para el prefijo de los roles"
}

variable "environment" {
  type        = string
  description = "Entorno (dev, stg, prod) para diferenciar políticas"
}

# --- Opcionales (Senior Tips) ---
variable "lambda_role_name" {
  type        = string
  default     = "lambda-exec-role"
  description = "Nombre base para el rol de ejecución de Lambda"
}

variable "lambda_role_arn" {
  type        = string
  description = "El ARN del rol de IAM que usará la función Lambda"
}

variable "tags" {
  type    = map(string)
  default = {}
}