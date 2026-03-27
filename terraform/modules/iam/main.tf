# 1. El "Trust Policy": Permite que el servicio Lambda use este rol
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-${var.environment}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

# 2. Política básica para CloudWatch Logs (Indispensable para debug)
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# 3. Política Integral (S3 + Textract + Bedrock + DynamoDB)
resource "aws_iam_policy" "processor_ai_permissions" {
  name        = "${var.project_name}-processor-ai-policy-${var.environment}"
  description = "Permisos para OCR, IA, S3 y persistencia en DynamoDB"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # --- PERMISOS DYNAMODB (Lo que faltaba) ---
        Effect   = "Allow"
        Action   = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:DescribeTable"
        ]
        Resource = [
          "arn:aws:dynamodb:eu-central-1:473959757331:table/${var.project_name}-${var.environment}-emissions",
          "arn:aws:dynamodb:eu-central-1:473959757331:table/${var.project_name}-${var.environment}-emissions/index/*"
        ]
      },
      {
        # --- PERMISOS TEXTRACT ---
        Effect   = "Allow"
        Action   = [
          "textract:DetectDocumentText",
          "textract:AnalyzeExpense",
          "textract:StartExpenseAnalysis",
          "textract:GetExpenseAnalysis",
          "textract:AnalyzeDocument"
          
        ]
        Resource = "*" 
      },
      {
        # --- PERMISOS BEDROCK ---
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:eu-central-1:*:inference-profile/eu.anthropic.claude-*",
          "arn:aws:bedrock:eu-*:*:foundation-model/anthropic.claude-*"
        ]
      },
      {
        # --- PERMISOS S3 ---
        Effect   = "Allow"
        Action   = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.project_name}-${var.environment}-uploads",
          "arn:aws:s3:::${var.project_name}-${var.environment}-uploads/*"
        ]
      }
    ]
  })
}

# 4. Adjuntar la política integral al Rol
resource "aws_iam_role_policy_attachment" "attach_ai_policy" {
  role       = aws_iam_role.lambda_exec.name 
  policy_arn = aws_iam_policy.processor_ai_permissions.arn
}