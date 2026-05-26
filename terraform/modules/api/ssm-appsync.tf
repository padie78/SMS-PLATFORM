# Parámetros SSM para romper dependencia circular api ↔ compute (worker lee URL/key).

resource "aws_ssm_parameter" "appsync_graphql_url" {
  name  = "/${var.project_name}/${var.environment}/appsync/graphql_url"
  type  = "String"
  value = aws_appsync_graphql_api.api.uris["GRAPHQL"]

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ssm_parameter" "appsync_api_key" {
  name  = "/${var.project_name}/${var.environment}/appsync/api_key"
  type  = "SecureString"
  value = aws_appsync_api_key.hub_key.key

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

output "appsync_url_ssm_parameter" {
  value = aws_ssm_parameter.appsync_graphql_url.name
}

output "appsync_api_key_ssm_parameter" {
  value = aws_ssm_parameter.appsync_api_key.name
}
