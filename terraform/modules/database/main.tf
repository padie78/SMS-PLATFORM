resource "aws_dynamodb_table" "emissions_table" {
  name         = "${var.project_name}-${var.environment}-emissions"
  billing_mode = var.billing_mode

  # PK (single-table): preferir convención multi-tenant `TENANT#<tenant>#ORG#<orgScope>` (Lambda).
  # Datos legacy pueden seguir usando ORG#<uuid> hasta migración.
  hash_key = "PK"
  # SK: Será "INV#..." para facturas o "STATS#..." para totales
  range_key = "SK"

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # Atributos para el GSI (Consultas transversales)
  attribute {
    name = "GSI1_PK" # Ej: service_type
    type = "S"
  }

  attribute {
    name = "GSI1_SK" # Ej: timestamp o co2_value
    type = "S"
  }

  global_secondary_index {
    name            = "GSI_Analytical"
    hash_key        = "GSI1_PK"
    range_key       = "GSI1_SK"
    projection_type = "ALL"
  }

  # Path enumeration: consultas begins_with(path) por tenant (holding)
  attribute {
    name = "holdingId"
    type = "S"
  }

  attribute {
    name = "path"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI_NodePath"
    hash_key        = "holdingId"
    range_key       = "path"
    projection_type = "ALL"
  }

  # Recomendado para auditoría: PITR habilitado siempre en producción
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  # TTL para limpiar items WIP del wizard (ver `computeWipTtl` en
  # libs/common). DynamoDB elimina automáticamente cualquier item cuyo
  # atributo `ttl` (epoch seconds) ya pasó. Si el usuario abandona el
  # wizard a mitad de carga, sus items quedan limpios en ~48h sin código.
  ttl {
    enabled        = var.enable_ttl
    attribute_name = var.ttl_attribute_name
  }

  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      Design      = "Single-Table-Pattern"
    },
    var.tags
  )
}