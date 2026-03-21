# --- Configuración de AWS ---
aws_region = "eu-central-1"

# --- Identificación del Proyecto ---
project_name = "sms-platform"
environment  = "dev"

# --- Configuración de Red y Seguridad (CORS) ---
# Dominios permitidos para tu app de Angular
cors_origins = [
  "http://localhost:4200",
  "https://midominio.com"
]

# --- Seguridad S3 (Public Access Block) ---
# Mantener en true para máxima seguridad en la nube
block_public_acls       = true
block_public_policy     = true
ignore_public_acls      = true
restrict_public_buckets = true

# --- Configuración de Cómputo y API ---
external_api_url    = "https://api.sustainability.example.com"
lambda_architecture = "arm64" # Mayor performance, menor costo
auto_deploy         = true

emissions_api_url = "https://api.carbon-tracking.com/v1"
emissions_api_key = "sk_prod_12345..."
bedrock_model_id  = "anthropic.claude-3-haiku-20240307-v1:0"

# --- Detalle de Rutas y CORS ---
query_route_path  = "/emissions"
signer_route_path = "/get-url"
api_cors_max_age  = 3600

api_cors_methods = [
  "GET", 
  "POST", 
  "OPTIONS", 
  "PUT", 
  "DELETE"
]

api_cors_headers = [
  "Content-Type", 
  "Authorization", 
  "X-Amz-Date", 
  "X-Api-Key", 
  "X-Amz-Security-Token"
]

# --- Configuración de la Tabla DynamoDB ---
# Nota: Si usas locals para el nombre, podés comentar esta línea 
# o usarla como el valor final que pasás al módulo.
table_name   = "sms-platform-dev-table"
billing_mode = "PAY_PER_REQUEST"

# --- Time to Live (TTL) ---
enable_ttl         = true
ttl_attribute_name = "ttl"

# --- Tags Globales ---
common_tags = {
  Project     = "SMS-Sustainability"
  ManagedBy   = "Terraform"
  Owner       = "Diego"
  Environment = "Development"
}
