# El "Trust Policy": Permite que el servicio Lambda use este rol
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

# Política para permitir la subida a S3 (PutObject)
resource "aws_iam_role_policy" "s3_policy" {
  name = "sms-platform-s3-upload-policy"
  role = aws_iam_role.lambda_exec.id  # <--- CORREGIDO: ahora coincide con "lambda_exec"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["s3:PutObject"]
        Effect   = "Allow"
        Resource = "arn:aws:s3:::sms-platform-dev-uploads/*"
      }
    ]
  })
}

# Política básica para que las Lambdas escriban logs en CloudWatch
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}