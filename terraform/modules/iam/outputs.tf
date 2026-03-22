output "lambda_role_arn" {
  # Debe ser lambda_exec porque así lo llamaste en el main.tf
  value = aws_iam_role.lambda_exec.arn
}