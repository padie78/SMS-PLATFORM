const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Configuración del cliente S3 (Reutilizado entre invocaciones)
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    console.log("Evento recibido:", JSON.stringify(event));

    try {
        // 1. Extraer Identidad (Compatible con HTTP API y JWT Authorizer)
        const claims = event.requestContext?.authorizer?.jwt?.claims || 
                       event.requestContext?.authorizer?.claims;

        if (!claims) {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: "Unauthorized: No identity context found" })
            };
        }

        // El 'sub' es el ID único del usuario en Cognito
        const userId = claims.sub;

        // 2. Parsear el Body
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing request body" })
            };
        }

        const { fileName, fileType } = JSON.parse(event.body);

        if (!fileName) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "fileName is required" })
            };
        }

        // 3. Generación de Key Estratégica
        // IMPORTANTE: Empezamos con 'uploads/' para que coincida con el trigger de Terraform
        const cleanFileName = fileName.replace(/\s+/g, '_').toLowerCase();
        const timestamp = Date.now();
        const key = `uploads/${userId}/${timestamp}-${cleanFileName}`;

        console.log(`Generando URL para: ${key}`);

        // 4. Preparar el comando de S3
        const command = new PutObjectCommand({
            Bucket: process.env.UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType || 'application/pdf'
        });

        // 5. Generar la Presigned URL (Válida por 5 minutos)
        const uploadURL = await getSignedUrl(s3Client, command, { expiresIn: 300 });

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                uploadURL,
                key,
                userId,
                message: "URL generada exitosamente. Use el método PUT para subir el archivo."
            })
        };

    } catch (error) {
        console.error("Error crítico en Signer:", error);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ 
                message: "Internal server error",
                requestId: event.requestContext?.requestId 
            })
        };
    }
};