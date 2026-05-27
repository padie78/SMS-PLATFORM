# ==============================================================================
# 1. POLÍTICAS DE CONFIANZA (Assume Role)
# ==============================================================================
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ==============================================================================
# 2. DEFINICIÓN DE ROLES (Dispatcher y Worker)
# ==============================================================================

resource "aws_iam_role" "dispatcher_lambda_role" {
  name               = "${var.project_name}-dispatcher-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "worker_lambda_role" {
  name               = "${var.project_name}-worker-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "api_lambda_role" {
  name               = "${var.project_name}-api-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "lambda_role" {
  name               = "${var.project_name}-generic-lambda-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# ==============================================================================
# 3. POLÍTICAS DE PERMISOS (SQS, IA, S3, DYNAMO)
# ==============================================================================

resource "aws_iam_policy" "dispatcher_sqs_publish" {
  name        = "${var.project_name}-dispatcher-sqs-publish-${var.environment}"
  description = "Permite enviar mensajes a la cola de facturas"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = "sqs:SendMessage"
      Effect   = "Allow"
      Resource = var.invoice_queue_arn
    }]
  })
}

resource "aws_iam_policy" "worker_sqs_consume" {
  name        = "${var.project_name}-worker-sqs-consume-${var.environment}"
  description = "Permite leer y borrar mensajes de la cola"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      Effect   = "Allow"
      Resource = var.invoice_queue_arn
    }]
  })
}

resource "aws_iam_policy" "ai_processing_policy" {
  name = "${var.project_name}-ai-policy-${var.environment}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["textract:DetectDocumentText", "textract:AnalyzeExpense", "textract:AnalyzeDocument"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = "bedrock:InvokeModel"
        Resource = [
          "arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
          "arn:aws:bedrock:eu-central-1:*:inference-profile/eu.anthropic.claude-*"
        ]
      }
    ]
  })
}

# --- Storage: S3 Access ---
resource "aws_iam_policy" "s3_processing_policy" {
  name = "${var.project_name}-s3-policy-${var.environment}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:GetBucketLocation"]
      Resource = ["arn:aws:s3:::${var.project_name}-${var.environment}-uploads", "arn:aws:s3:::${var.project_name}-${var.environment}-uploads/*"]
    }]
  })
}

resource "aws_iam_policy" "worker_appsync_ssm_read" {
  name        = "${var.project_name}-worker-appsync-ssm-${var.environment}"
  description = "Permite al worker leer URL/API key de AppSync desde SSM (rompe ciclo TF api↔compute)"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = [
        "arn:aws:ssm:*:*:parameter/${var.project_name}/${var.environment}/appsync/graphql_url",
        "arn:aws:ssm:*:*:parameter/${var.project_name}/${var.environment}/appsync/api_key"
      ]
    }]
  })
}

resource "aws_iam_policy" "dynamo_app_policy" {
  name = "${var.project_name}-dynamo-policy-${var.environment}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:DeleteItem",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:TransactWriteItems"
      ]
      Resource = [var.dynamo_table_arn, "${var.dynamo_table_arn}/index/*"]
    }]
  })
}

# ==============================================================================
# 4. ATTACHMENTS (Vincular todo)
# ==============================================================================

# Logs básicos para todos los roles
resource "aws_iam_role_policy_attachment" "basic_execution" {
  for_each = toset([
    aws_iam_role.dispatcher_lambda_role.name,
    aws_iam_role.worker_lambda_role.name,
    aws_iam_role.api_lambda_role.name,
    aws_iam_role.lambda_role.name
  ])
  role       = each.value
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Dispatcher: SQS Send + Dynamo (Skeleton) ---
resource "aws_iam_role_policy_attachment" "dispatcher_sqs" {
  role       = aws_iam_role.dispatcher_lambda_role.name
  policy_arn = aws_iam_policy.dispatcher_sqs_publish.arn
}

resource "aws_iam_role_policy_attachment" "dispatcher_dynamo" {
  role       = aws_iam_role.dispatcher_lambda_role.name
  policy_arn = aws_iam_policy.dynamo_app_policy.arn
}

# --- Worker: SQS Consume + IA + S3 + Dynamo ---
resource "aws_iam_role_policy_attachment" "worker_sqs" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = aws_iam_policy.worker_sqs_consume.arn
}
resource "aws_iam_role_policy_attachment" "worker_ai" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = aws_iam_policy.ai_processing_policy.arn
}
resource "aws_iam_role_policy_attachment" "worker_s3" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = aws_iam_policy.s3_processing_policy.arn
}
resource "aws_iam_role_policy_attachment" "worker_dynamo" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = aws_iam_policy.dynamo_app_policy.arn
}
resource "aws_iam_role_policy_attachment" "worker_appsync_ssm" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = aws_iam_policy.worker_appsync_ssm_read.arn
}

# --- API Role: Dynamo + S3 ---
resource "aws_iam_role_policy_attachment" "api_dynamo" {
  role       = aws_iam_role.api_lambda_role.name
  policy_arn = aws_iam_policy.dynamo_app_policy.arn
}

# --- Generic role also needs Dynamo for KPI engine (uses TransactWrite) ---
resource "aws_iam_role_policy_attachment" "generic_dynamo" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.dynamo_app_policy.arn
}

# --- Signer: S3 Access ---
resource "aws_iam_role_policy_attachment" "generic_s3" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.s3_processing_policy.arn
}

# ==============================================================================
# 5. TRIGGERS (Nota: Definidos en raíz)
# ==============================================================================