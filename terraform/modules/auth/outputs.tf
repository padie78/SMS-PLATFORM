output "user_pool_arn" {
  description = "ARN del User Pool para el API Gateway Authorizer"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_id" {
  description = "ID del User Pool para la CLI de AWS"
  value       = aws_cognito_user_pool.main.id
}

output "client_id" {
  description = "ID del Cliente para el Frontend o Postman"
  value       = aws_cognito_user_pool_client.client.id
}

output "user_pool_endpoint" {
  # Esto limpia el "https://" si el módulo API lo agrega después
  value = aws_cognito_user_pool.main.endpoint
}