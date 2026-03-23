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
resource "aws_iam_policy" "processor_ai_permissions" {
  name        = "${var.project_name}-processor-ai-policy-${var.environment}"
  description = "Permisos consolidados para OCR (Textract), IA (Bedrock Claude 4.5/3.5) y S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Permisos para Textract: Soporte completo para procesamiento de facturas y PDFs
        Effect   = "Allow"
        Action   = [
          "textract:DetectDocumentText",
          "textract:AnalyzeExpense",
          "textract:StartExpenseAnalysis",
          "textract:GetExpenseAnalysis"
        ]
        Resource = "*" 
      },
      {
        # Permiso FLEXIBLE para Bedrock:
        # Permite modelos base de la serie 3, 3.5 y 4.x, así como perfiles de inferencia regionales.
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = [
        # Permiso para el Perfil de Inferencia (el que usas en el código)
          "arn:aws:bedrock:eu-central-1:*:inference-profile/eu.anthropic.claude-*",
          
          # Permiso para los modelos base en Europa (necesario para el balanceo automático)
          "arn:aws:bedrock:eu-*:*:foundation-model/anthropic.claude-*"
        ]
      },
      {
        # Permisos de S3: Acceso al bucket de carga del proyecto
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