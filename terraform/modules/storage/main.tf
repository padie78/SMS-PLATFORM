# 1. Bucket de Carga (Uploads) usando el módulo oficial
module "s3_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = "${var.project_name}-${var.environment}-uploads"

  block_public_acls       = var.block_public_acls
  block_public_policy     = var.block_public_policy
  ignore_public_acls      = var.ignore_public_acls
  restrict_public_buckets = var.restrict_public_buckets

  versioning = {
    enabled = var.versioning_enabled
  }

  cors_rule = [
    {
      allowed_headers = var.cors_allowed_headers
      allowed_methods = var.cors_allowed_methods
      allowed_origins = var.cors_allowed_origins
      expose_headers  = ["ETag"]
      max_age_seconds = 3000
    }
  ]

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# 2. Bucket de Frontend (Hosting Estático)
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-${var.environment}-frontend"
  
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# Configuración de sitio web (Refactorizado para evitar bloques obsoletos)
resource "aws_s3_bucket_website_configuration" "frontend_config" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

# Permiso para que S3 invoque la Lambda
resource "aws_lambda_permission" "s3_invoke_processor" {
  statement_id  = "AllowS3InvokeProcessor"
  action        = "lambda:InvokeFunction"
  function_name = var.processor_lambda_name
  principal     = "s3.amazonaws.com"
  source_arn    = module.s3_bucket.s3_bucket_arn
}

resource "aws_s3_bucket_notification" "processor_trigger" {
  bucket = module.s3_bucket.s3_bucket_id

  lambda_function {
    lambda_function_arn = var.processor_lambda_arn
    events              = ["s3:ObjectCreated:Put", "s3:ObjectCreated:Post"] 
    
    # Si el ID del cliente va al principio, dejamos el prefijo vacío 
    # o lo cambiamos para que busque en cualquier carpeta pero solo PDFs
  }
  depends_on = [aws_lambda_permission.s3_invoke_processor]
}