# ==============================================================================
# 1. EMPAQUETADO DE CÓDIGO (ZIPs)
# ==============================================================================
# Rutas relativas a cada `source_dir`. NO se excluye `node_modules` completo:
# la Lambda necesita dependencias de producción en runtime.
# Sí se excluye basura habitual (types, tests, markdown) para achicar el artefacto.

locals {
  lambda_zip_excludes = [
    ".git/**",
    ".github/**",
    "node_modules/.cache/**",
    "node_modules/**/.cache/**",
    "node_modules/@types/**",
    "node_modules/**/README*",
    "node_modules/**/*.md",
    "node_modules/**/CHANGELOG*",
    "node_modules/**/LICENSE*",
    "node_modules/**/LICENCE*",
    "node_modules/**/test/**",
    "node_modules/**/tests/**",
    "node_modules/**/__tests__/**",
    "node_modules/**/docs/**",
    "node_modules/**/.github/**",
    "node_modules/**/*.map",
    "node_modules/**/coverage/**"
  ]
}

data "external" "build_dispatcher_lambda" {
  program = [
    "bash",
    "${path.root}/scripts/build-lambda.sh",
    "dispatcher-lambda",
    abspath("${path.root}/../dist/lambda_code/dispatcher_lambda")
  ]
}

data "external" "build_worker_lambda" {
  program = [
    "bash",
    "${path.root}/scripts/build-lambda.sh",
    "worker-lambda",
    abspath("${path.root}/../dist/lambda_code/worker_lambda")
  ]
}

data "archive_file" "dispatcher_zip" {
  type        = "zip"
  source_dir  = data.external.build_dispatcher_lambda.result.bundle_dir
  output_path = "${path.module}/zips/dispatcher.zip"
}

data "archive_file" "worker_zip" {
  type        = "zip"
  source_dir  = data.external.build_worker_lambda.result.bundle_dir
  output_path = "${path.module}/zips/worker.zip"
}

data "archive_file" "signer_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../lambda_code/signer_lambda"
  output_path = "${path.module}/zips/signer.zip"
  excludes    = local.lambda_zip_excludes
}

# -----------------------------------------------------------------------------
# api_lambda: empaquetar el bundle Nx (esbuild) — NO el source raw.
# -----------------------------------------------------------------------------
# El source raw `lambda_code/api_lambda` no tiene `node_modules` ni resuelve los
# alias `@sms/*` en runtime. El bundle bundleado por esbuild en `dist/...` SÍ.
#
# `data.external.build_api_lambda` se evalúa en `terraform plan` y dispara el
# build Nx, garantizando que el directorio exista antes de que `archive_file`
# intente leerlo. Si ya está cacheado por Nx, el rebuild es ~1s.
# Para saltar el build en CI cuando otro step ya lo hizo, exportar
# `SMS_SKIP_LAMBDA_BUILD=1`.
data "external" "build_api_lambda" {
  program = [
    "bash",
    "${path.root}/scripts/build-lambda.sh",
    "api-lambda",
    # abspath() obligatorio: el script hace `cd $REPO_ROOT` antes de validar
    # y un path relativo cambiaría de significado tras el `cd`.
    abspath("${path.root}/../dist/lambda_code/api_lambda"),
  ]
}

data "archive_file" "api_lambda_zip" {
  type        = "zip"
  source_dir  = data.external.build_api_lambda.result.bundle_dir
  output_path = "${path.module}/zips/api_lambda.zip"
}

data "archive_file" "analytics_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../lambda_code/analytics_lambda"
  output_path = "${path.module}/zips/analytics.zip"
  excludes    = local.lambda_zip_excludes
}

data "archive_file" "kpi_zip" {
  type        = "zip"
  source_dir  = "${path.root}/../lambda_code/kpi_engine_lambda"
  output_path = "${path.module}/zips/kpi.zip"
  excludes    = local.lambda_zip_excludes
}

# ==============================================================================
# 2. CONFIGURACIÓN DE LAMBDAS
# ==============================================================================

# --- DISPATCHER: Gatillo de S3 ---
resource "aws_lambda_function" "dispatcher_lambda" {
  function_name = "${var.project_name}-dispatcher-${var.environment}"
  filename      = data.archive_file.dispatcher_zip.output_path
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  role          = var.dispatcher_role_arn
  timeout       = 10
  memory_size   = 128
  architectures = [var.lambda_architecture]

  environment {
    variables = {
      SQS_QUEUE_URL = var.sqs_queue_url
      DYNAMO_TABLE  = var.dynamo_table_name
      ENVIRONMENT   = var.environment
    }
  }
  source_code_hash = data.archive_file.dispatcher_zip.output_base64sha256
}

# --- WORKER: Procesador de SQS (Pesado) ---
resource "aws_lambda_function" "worker_lambda" {
  function_name = "${var.project_name}-worker-${var.environment}"
  filename      = data.archive_file.worker_zip.output_path
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  role          = var.worker_role_arn
  timeout       = 300 # 5 minutos para Textract + Bedrock
  memory_size   = 512
  architectures = [var.lambda_architecture]

  environment {
    variables = {
      DYNAMO_TABLE      = var.dynamo_table_name
      BEDROCK_MODEL_ID  = var.bedrock_model_id
      EMISSIONS_API_URL = var.emissions_api_url
      EMISSIONS_API_KEY = var.emissions_api_key
      APPSYNC_URL       = var.appsync_url
      APPSYNC_API_KEY   = var.appsync_api_key
      ENVIRONMENT       = var.environment
    }
  }
  source_code_hash = data.archive_file.worker_zip.output_base64sha256
}

# --- SIGNER: URLs de subida ---
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

locals {
  api_lambda_env = merge(
    {
      DYNAMO_TABLE  = var.dynamo_table_name
      SQS_QUEUE_URL = var.sqs_queue_url
    },
    var.allow_tenant_fallback_from_sub ? { ALLOW_TENANT_FALLBACK_FROM_SUB = "true" } : {},
    trimspace(var.default_organization_scope_id) != "" ? { DEFAULT_ORGAN_SCOPE_ID = trimspace(var.default_organization_scope_id) } : {}
  )
}

# --- API: CRUD de GraphQL/AppSync ---
resource "aws_lambda_function" "api_lambda" {
  function_name = "${var.project_name}-api-${var.environment}"
  filename      = data.archive_file.api_lambda_zip.output_path
  # Bundle producido por esbuild → `main.js` con `export const handler`.
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  role          = var.api_lambda_role_arn
  timeout       = 15
  memory_size   = 256
  architectures = [var.lambda_architecture]

  environment {
    variables = local.api_lambda_env
  }
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256
}

# --- ANALYTICS & KPI ENGINE ---
resource "aws_lambda_function" "analytics" {
  function_name = "${var.project_name}-analytics-${var.environment}"
  filename      = data.archive_file.analytics_zip.output_path
  handler       = "src/index.handler"
  runtime       = "nodejs20.x"
  role          = var.api_lambda_role_arn
  timeout       = 20
  memory_size   = 512
  architectures = [var.lambda_architecture]

  environment {
    variables = {
      DYNAMO_TABLE = var.dynamo_table_name
    }
  }
  source_code_hash = data.archive_file.analytics_zip.output_base64sha256
}

resource "aws_lambda_function" "kpi_engine" {
  function_name = "${var.project_name}-kpi-engine-${var.environment}"
  filename      = data.archive_file.kpi_zip.output_path
  handler       = "src/index.handler"
  runtime       = "nodejs20.x"
  role          = var.lambda_role_arn
  timeout       = 20
  memory_size   = 512
  architectures = [var.lambda_architecture]

  environment {
    variables = {
      DYNAMO_TABLE = var.dynamo_table_name
    }
  }
  source_code_hash = data.archive_file.kpi_zip.output_base64sha256
}

resource "aws_lambda_event_source_mapping" "sqs_to_worker" {
  event_source_arn = var.invoice_queue_arn
  function_name    = aws_lambda_function.worker_lambda.arn # <--- Verificá que se llame así
  batch_size       = 1
  enabled          = true

  # Opcional: Ayuda a que Terraform entienda el orden de creación
  depends_on = [aws_lambda_function.worker_lambda]
}
# ==============================================================================
# 3. OBSERVABILIDAD (Logs)
# ==============================================================================

resource "aws_cloudwatch_log_group" "dispatcher_logs" {
  name              = "/aws/lambda/${var.project_name}-dispatcher-${var.environment}"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker_logs" {
  name              = "/aws/lambda/${var.project_name}-worker-${var.environment}"
  retention_in_days = 14
}