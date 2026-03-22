# --- AUTHORIZER (El validador de Cognito) ---
resource "aws_apigatewayv2_authorizer" "cognito_auth" {
  api_id           = var.api_id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.project_name}-cognito-auth-${var.environment}"

  jwt_configuration {
    # El audience es el Client ID de la App en Cognito que usa Angular
    audience = [var.cognito_client_id] 
    # El issuer es la URL de tu User Pool
    issuer   = "https://${var.cognito_endpoint}"
  }
}

# --- INTEGRACIONES (El puente a las Lambdas) ---
resource "aws_apigatewayv2_integration" "signer_integration" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.signer_lambda_arn
  payload_format_version = "2.0"
}

# --- RUTAS PROTEGIDAS ---

# Ruta GET /emissions (Query)

# Ruta POST /get-url (Signer)
resource "aws_apigatewayv2_route" "signer_route" {
  api_id             = var.api_id
  route_key          = "POST ${var.signer_route_path}"
  target             = "integrations/${aws_apigatewayv2_integration.signer_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_auth.id
}

# --- PERMISOS (Para que API Gateway pueda "llamar" a la Lambda) ---
resource "aws_lambda_permission" "signer_permission" {
  statement_id  = "AllowExecutionFromAPIGatewaySigner"
  action        = "lambda:InvokeFunction"
  function_name = var.signer_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}