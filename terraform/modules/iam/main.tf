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

# 2. Política básica para CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# 3. Política Integral (S3 + Textract Asíncrono + Bedrock)
# He consolidado s3_policy, textract_extra_policy y processor_ai_permissions aquí
resource "aws_iam_policy" "processor_ai_permissions" {
  name        = "${var.project_name}-processor-ai-policy-${var.environment}"
  description = "Permisos consolidados para OCR (Textract Asíncrono), IA (Bedrock) y S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Permisos para Textract: Se agregan las acciones asíncronas para PDFs
        Effect   = "Allow"
        Action   = [
          "textract:DetectDocumentText",
          "textract:AnalyzeExpense",
          "textract:StartExpenseAnalysis", # <--- REQUERIDO para el nuevo código
          "textract:GetExpenseAnalysis"    # <--- REQUERIDO para el nuevo código
        ]
        Resource = "*" 
      },
      {
        # Permiso específico para Claude 3 Haiku en Bedrock
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
      },
      {
        # Permisos de S3: Combinamos PutObject y GetObject en un solo bloque
        Effect   = "Allow"
        Action   = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "arn:aws:s3:::${var.project_name}-${var.environment}-uploads/*"
      }
    ]
  })
}

# 4. Adjuntar la política integral al Rol
resource "aws_iam_role_policy_attachment" "attach_ai_policy" {
  role       = aws_iam_role.lambda_exec.name 
  policy_arn = aws_iam_policy.processor_ai_permissions.arn
}