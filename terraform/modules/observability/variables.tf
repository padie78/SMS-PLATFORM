variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "worker_log_group_name" {
  type    = string
  default = ""
}

variable "dlq_queue_name" {
  type    = string
  default = ""
}

variable "worker_lambda_name" {
  type    = string
  default = ""
}
