resource "aws_dynamodb_table" "emissions_table" {
  name         = "${var.project_name}-${var.environment}-emissions"
  billing_mode = var.billing_mode

  # PK: Siempre será "ORG#<UUID>"
  hash_key  = "PK" 
  # SK: Será "INV#..." para facturas o "STATS#..." para totales
  range_key = "SK" 

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

  # Recomendado para auditoría: PITR habilitado siempre en producción
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
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