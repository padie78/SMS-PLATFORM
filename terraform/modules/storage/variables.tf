variable "project_name" { type = string }
variable "environment"  { type = string }

# Seguridad de S3
variable "block_public_acls"       { 
  type = bool 
  default = true 
  description = "Bloquea completamente las ACLs públicas para el bucket."
}
variable "block_public_policy"     { 
  type = bool 
  default = true 
  description = "Bloquea completamente las políticas públicas para el bucket."
}
variable "ignore_public_acls"      { 
  type = bool 
  default = true 
  description = "Ignora las ACLs públicas para el bucket."
}
variable "restrict_public_buckets" { 
  type = bool 
  default = true 
  description = "Restringe los buckets públicos para el bucket."
}
variable "versioning_enabled"      { 
  type = bool 
  default = false 
  description = "Habilita el versionado para el bucket."
}
# CORS dinámico
variable "cors_allowed_origins" { 
  type = list(string) 
  default = ["*"] 
  description = "Orígenes permitidos para CORS."
}
variable "cors_allowed_methods" { 
  type = list(string) 
  default = ["GET", "POST", "PUT"] 
  description = "Métodos permitidos para CORS."
}
variable "cors_allowed_headers" { 
  type = list(string) 
  default = ["*"] 
  description = "Encabezados permitidos para CORS."
}

variable "processor_lambda_arn" {
  type = string
}

variable "processor_lambda_name" {
  type = string
}