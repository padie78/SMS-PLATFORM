output "authorizer_id" {
  description = "ID del Authorizer de Cognito"
  value       = aws_apigatewayv2_authorizer.cognito_auth.id
}

output "signer_route_id" {
  value = aws_apigatewayv2_route.signer_route.id
}

variable "lambda_role_arn" {
  description = "ARN del rol de Lambda generado por el módulo IAM"
  type        = string
} 

# Si el recurso del API Gateway está en este módulo:
output "api_url" {
  value = aws_apigatewayv2_api.main.api_endpoint
}