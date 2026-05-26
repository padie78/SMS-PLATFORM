terraform {
  required_version = ">= 1.6.0"

  # --- BACKEND REMOTO (El "Cerebro" de Terraform) ---
  # IMPORTANTE: Debés crear el bucket "sms-platform-terraform-state-diego" 
  # (o el nombre que elijas) manualmente en la consola antes de hacer el push.
  backend "s3" {
    bucket  = "sms-platform-terraform-state-diego" # Cambiá esto por el nombre de tu bucket real
    key     = "sms-platform/terraform.tfstate"
    region  = "eu-central-1"
    encrypt = true
    # dynamodb_table = "terraform-lock" # Habilitalo si creás una tabla Dynamo para locking
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.5.0"
    }
    # Usado para ejecutar `nx build` antes de empaquetar los Lambdas que tienen
    # sources TypeScript (alias `@sms/*`). Ver `modules/compute/main.tf`.
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3.0"
    }
  }
}

# --- CONFIGURACIÓN DEL PROVIDER ---
provider "aws" {
  region = "eu-central-1"

  # Estos tags se aplican a TODO lo que crees automáticamente
  default_tags {
    tags = {
      Project     = "SMS-Platform"
      Environment = "dev"
      Owner       = "Diego"
      ManagedBy   = "Terraform"
    }
  }
}