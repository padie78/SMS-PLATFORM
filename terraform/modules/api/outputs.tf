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