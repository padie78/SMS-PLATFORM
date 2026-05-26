# ==============================================================================
# 1. API GraphQL (Appsync)
# ==============================================================================
resource "aws_appsync_graphql_api" "api" {
  name                = "${var.project_name}-hub-${var.environment}"
  authentication_type = "AMAZON_COGNITO_USER_POOLS"
  schema              = file("${path.module}/schema.graphql")
  xray_enabled        = true

  user_pool_config {
    default_action = "ALLOW"
    user_pool_id   = var.cognito_user_pool_id
    aws_region     = var.cognito_region
  }

  additional_authentication_provider {
    authentication_type = "API_KEY"
  }

  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_runtime_role.arn
    field_log_level          = "ALL"
  }
}

resource "aws_appsync_api_key" "hub_key" {
  api_id  = aws_appsync_graphql_api.api.id
  expires = timeadd(timestamp(), "8760h")
}

# ==============================================================================
# 2. ROL DE IAM PARA RUNTIME (APPSYNC)
# ==============================================================================
resource "aws_iam_role" "appsync_runtime_role" {
  name = "${var.project_name}-appsync-runtime-role-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "appsync.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "appsync_logs" {
  role       = aws_iam_role.appsync_runtime_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppSyncPushToCloudWatchLogs"
}

# ==============================================================================
# 3. DATA SOURCES
# ==============================================================================
resource "aws_appsync_datasource" "api_lambda_ds" {
  api_id           = aws_appsync_graphql_api.api.id
  name             = "APILambdaDS"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_runtime_role.arn
  lambda_config { function_arn = var.api_lambda_arn }
}

resource "aws_appsync_datasource" "signer_lambda_ds" {
  api_id           = aws_appsync_graphql_api.api.id
  name             = "SignerLambdaDS"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_runtime_role.arn
  lambda_config { function_arn = var.signer_lambda_arn }
}

resource "aws_appsync_datasource" "analytics_lambda_ds" {
  api_id           = aws_appsync_graphql_api.api.id
  name             = "AnalyticsLambdaDataSource"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_runtime_role.arn
  lambda_config { function_arn = var.analytics_lambda_arn }
}

# ==============================================================================
# 4. RESOLVERS
# ==============================================================================
# Solo campos presentes en schema.graphql (Mutation). Amplía el set si añades mutaciones al schema.
resource "aws_appsync_resolver" "mutation_resolvers" {
  for_each = toset([
    "saveNode",
    "updateNode",
    "deleteNode",
    "createInvoiceDraft",
    "commitInvoiceLifecycle"
  ])

  api_id      = aws_appsync_graphql_api.api.id
  type        = "Mutation"
  field       = each.key
  data_source = aws_appsync_datasource.api_lambda_ds.name

  request_template  = file("${path.module}/resolvers/invoke-api-lambda-with-holding.vtl")
  response_template = file("${path.module}/resolvers/lambda-default-response.vtl")

  # Forzamos a que el Schema se haya cargado antes de intentar crear los resolvers
  depends_on = [
    aws_appsync_graphql_api.api,
    aws_appsync_datasource.api_lambda_ds,
    aws_iam_role_policy.appsync_access_policy
  ]
}

# KPI / analytics: descomenta y alinea con schema.graphql cuando expongas esas Queries.
# resource "aws_appsync_resolver" "kpi_resolvers" { ... }

resource "aws_appsync_resolver" "get_presigned_url" {
  api_id      = aws_appsync_graphql_api.api.id
  type        = "Mutation"
  field       = "getPresignedUrl"
  data_source = aws_appsync_datasource.signer_lambda_ds.name

  request_template  = file("${path.module}/resolvers/invoke-api-lambda-with-holding.vtl")
  response_template = file("${path.module}/resolvers/lambda-default-response.vtl")

  depends_on = [
    aws_appsync_graphql_api.api,
    aws_appsync_datasource.signer_lambda_ds,
    aws_iam_role_policy.appsync_access_policy
  ]
}

resource "aws_appsync_resolver" "api_lambda_queries" {
  for_each = toset(["getTree", "getNode", "getInvoice", "getInvoiceLifecycle"])

  api_id      = aws_appsync_graphql_api.api.id
  type        = "Query"
  field       = each.key
  data_source = aws_appsync_datasource.api_lambda_ds.name

  request_template  = file("${path.module}/resolvers/invoke-api-lambda-with-holding.vtl")
  response_template = file("${path.module}/resolvers/lambda-default-response.vtl")

  depends_on = [
    aws_appsync_graphql_api.api,
    aws_appsync_datasource.api_lambda_ds,
    aws_iam_role_policy.appsync_access_policy
  ]
}

# ==============================================================================
# 5. POLÍTICA DE ACCESO (APPSYNC -> LAMBDA)
# ==============================================================================
## Política del rol runtime de AppSync.
## Solo necesita invocar las Lambdas configuradas como data sources. NO se otorga
## acceso directo a DynamoDB porque NINGÚN resolver usa `AWS_LAMBDA` → Dynamo
## directamente: toda lectura/escritura pasa por la `api_lambda` (con su rol propio).
resource "aws_iam_role_policy" "appsync_access_policy" {
  name = "AppSyncAccessPolicy"
  role = aws_iam_role.appsync_runtime_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowLambdaInvocation"
        Action = ["lambda:InvokeFunction"]
        Effect = "Allow"
        Resource = [
          var.api_lambda_arn, "${var.api_lambda_arn}:*",
          var.signer_lambda_arn, "${var.signer_lambda_arn}:*",
          var.analytics_lambda_arn, "${var.analytics_lambda_arn}:*"
        ]
      }
    ]
  })
}

# ==============================================================================
# 6. PERMISOS EXTENDIDOS PARA LA LAMBDA API (S3 + AI)
# ==============================================================================

# NOTA: Como no encuentra var.api_lambda_role_id, usamos el nombre del Rol 
# que deberías tener definido donde creaste la Lambda. 
# Si tu recurso de rol se llama diferente, cambia "api_lambda_role" abajo.

## Política extendida del API Lambda.
## Principio de mínimo privilegio (Well-Architected: Security):
##   - Solo S3 read en el bucket de upload (necesario para futura lectura de
##     adjuntos en queries `getInvoice`).
##   - NO se otorgan permisos de Textract ni Bedrock: ese trabajo lo realiza el
##     `worker_lambda` (OCR) y un pipeline de IA dedicado, no el resolver API.
resource "aws_iam_role_policy" "api_lambda_extended_policy" {
  name = "${var.project_name}-api-extended-policy-${var.environment}"
  role = var.api_lambda_role_id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowS3ReadSpecificBucket"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [
          var.upload_bucket_arn,
          "${var.upload_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_appsync_datasource" "passthrough_ds" {
  api_id = aws_appsync_graphql_api.api.id
  name   = "PassthroughDataSource"
  type   = "NONE"
}

resource "aws_appsync_resolver" "update_status_passthrough" {
  api_id      = aws_appsync_graphql_api.api.id
  type        = "Mutation"
  field       = "updateInvoiceStatus"
  data_source = aws_appsync_datasource.passthrough_ds.name

  # Request Mapping Template: Envía los argumentos directo al payload
  request_template = <<EOF
{
    "version": "2018-05-29",
    "payload": {
        "id": "$context.arguments.id",
        "status": "$context.arguments.status",
        "extractedData": $util.toJson($context.arguments.extractedData),
        "message": $util.toJson($context.arguments.message)
    }
}
EOF

  # Response Mapping Template: Devuelve el payload como resultado
  response_template = <<EOF
$util.toJson($context.result)
EOF
}
