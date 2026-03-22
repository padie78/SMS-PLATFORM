# modules/api/outputs.tf

output "authorizer_id" {
  description = "ID del Authorizer de Cognito"
  value       = aws_apigatewayv2_authorizer.cognito_auth.id
}

# Si querés exportar los IDs de las rutas
output "signer_route_id" {
  value = aws_apigatewayv2_route.signer_route.id
}