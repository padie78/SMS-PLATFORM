output "query_lambda_arn" {
  value = aws_lambda_function.query.arn
}

output "query_lambda_name" {
  value = aws_lambda_function.query.function_name
}

output "signer_lambda_arn" {
  value = aws_lambda_function.signer.arn
}

output "signer_lambda_name" {
  value = aws_lambda_function.signer.function_name
}