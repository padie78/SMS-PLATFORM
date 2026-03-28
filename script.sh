#!/bin/bash

# --- CONFIGURACIÓN ---
REGION="eu-central-1"
CLIENT_ID="3fd0buanhinsiofrq03kavj2mi"
USER_POOL_ID="eu-central-1_LJE1bkULW"

# Asegurate que la URL incluya el stage /dev si así está en tu API Gateway
API_BASE_URL="https://15bj1vq521.execute-api.eu-central-1.amazonaws.com"
API_PATH="/get-url"

TEST_FILE="./factura.jpg"

# Datos del Usuario
USERNAME="diego_liascovich"
PASSWORD="DLpdp1980!"
EMAIL="padie78@gmail.com"

echo "🚀 Iniciando proceso E2E con estructura de carpetas..."

# 1. Registro y Confirmación (Omitimos salida si ya existe)
aws cognito-idp sign-up --region $REGION --client-id $CLIENT_ID --username "$USERNAME" --password "$PASSWORD" --user-attributes Name=email,Value="$EMAIL" 2>/dev/null
aws cognito-idp admin-confirm-sign-up --region $REGION --user-pool-id $USER_POOL_ID --username "$USERNAME" 2>/dev/null

# 2. Login Dinámico
echo "🔑 Obteniendo Token..."
ID_TOKEN=$(aws cognito-idp initiate-auth \
    --region $REGION \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id $CLIENT_ID \
    --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
    --query 'AuthenticationResult.IdToken' \
    --output text)

if [ "$ID_TOKEN" == "None" ]; then echo "❌ Error en Login"; exit 1; fi

# 3. Solicitud de Presigned URL
# IMPORTANTE: La Lambda recibirá el Token y ella decidirá la ruta 'uploads/{clientId}/...'
echo "📡 Solicitando URL firmada..."
RESPONSE=$(curl -s -X POST "${API_BASE_URL}${API_PATH}" \
    -H "Authorization: Bearer $ID_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{ \"fileName\": \"factura.jpg\", \"fileType\": \"application/jpg\" }")

UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadURL // empty')
# Capturamos el userId que devuelve tu Lambda para informar en consola
USER_ID=$(echo $RESPONSE | jq -r '.userId // "unknown"') 

if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" == "null" ]; then
    echo "❌ Error en API: $RESPONSE"
    exit 1
fi

echo "✅ URL recibida para el Cliente: $USER_ID"

# 4. Upload a S3
echo "📤 Subiendo archivo a S3..."
UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
    --upload-file "$TEST_FILE" \
    -H "Content-Type: application/jpg")

if [ "$UPLOAD_STATUS" == "200" ]; then
    echo "🎉 ¡ÉXITO! Archivo guardado en S3."
    echo "📍 Ruta: uploads/$USER_ID/factura.jpg"
else
    echo "❌ Error en S3. Status: $UPLOAD_STATUS"
fi