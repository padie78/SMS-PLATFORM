variable "project_name" {
  type        = string
  description = "Nombre del proyecto"
}

variable "environment" {
  type        = string
  description = "Entorno (dev/prod)"
}

variable "dynamodb_table_arn" {
  type        = string
}

variable "ami_id" {
  type        = string
}

variable "key_name" {
  type        = string
}

variable "allowed_ip_network" {
  type        = string
}

variable "vpc_id" {
  type        = string
  description = "ID de la VPC por defecto en Frankfurt"
}