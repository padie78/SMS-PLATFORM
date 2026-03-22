# --- EMPAQUETADO DE CÓDIGO ---

data "archive_file" "signer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda_code/signer_lambda"
  output_path = "${path.module}/zips/signer.zip"
}

data "archive_file" "processor_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda_code/processor_lambda"
  output_path = "${path.module}/zips/processor.zip"
}

# --- LAMBDA 1: SIGNER (Genera URL para el Frontend) ---

resource "aws_lambda_function" "signer" {
  function_name = "${var.project_name}-signer-${var.environment}"
  filename      = data.archive_file.signer_zip.output_path
  handler       = "src/index.handler"
  runtime       = "nodejs20.x"
  role          = var.lambda_role_arn
  architectures = [var.lambda_architecture]

  environment {
    variables = {
      UPLOAD_BUCKET = var.upload_bucket_name
    }
  }

  source_code_hash = data.archive_file.signer_zip.output_base64sha256
}

# --- LAMBDA 2: PROCESSOR (Procesa con Bedrock y guarda en Dynamo) ---

resource "aws_lambda_function" "processor" {
  function_name = "${var.project_name}-processor-${var.environment}"
  filename      = data.archive_file.processor_zip.output_path
  handler       = "src/index.handler"
  runtime       = "nodejs20.x"
  role          = var.lambda_role_arn
  timeout       = 60 
  memory_size   = 512 # Agregado para performance de CPU
  architectures = [var.lambda_architecture]

  # Recomendado: Capa de logs para debugging
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${var.project_name}-processor-${var.environment}"
  }

  environment {
    variables = {
      DYNAMO_TABLE      = var.dynamo_table_name
      BEDROCK_MODEL_ID  = var.bedrock_model_id
      EMISSIONS_API_URL = var.emissions_api_url
      EMISSIONS_API_KEY = var.emissions_api_key
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1" # Optimiza llamadas HTTP
    }
  }

  source_code_hash = data.archive_file.processor_zip.output_base64sha256
}

# No olvides el Log Group para que no se borren tus logs de debug
resource "aws_cloudwatch_log_group" "processor_logs" {
  name              = "/aws/lambda/${var.project_name}-processor-${var.environment}"
  retention_in_days = 14
}