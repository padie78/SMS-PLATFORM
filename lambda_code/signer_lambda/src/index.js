const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Instanciamos fuera para optimizar el rendimiento (Warm Starts)
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    // 1. Validación de existencia de body y contexto de autoría
    if (!event.body || !event.requestContext?.authorizer) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Invalid request: Missing body or authorization context" })
        };
    }

    try {
        // Extraemos la identidad real desde el Token de Cognito (Identity-Based)
        // El 'sub' es el ID único del usuario, el 'username' es su nombre de login.
        const userId = event.requestContext.authorizer.claims.sub || 
                       event.requestContext.authorizer.claims['cognito:username'];

        const { fileName, fileType } = JSON.parse(event.body);

        // 2. Validación de campos obligatorios
        if (!fileName) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "fileName is required" })
            };
        }

        // 3. Sanitización y Generación de Key Dinámica
        // Usamos el userId de Cognito para garantizar aislamiento entre clientes (SaaS Architecture)
        const cleanFileName = fileName.replace(/\s+/g, '_').toLowerCase();
        const timestamp = Date.now();
        const key = `${userId}/uploads/${timestamp}-${cleanFileName}`;

        const command = new PutObjectCommand({
            Bucket: process.env.UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType || 'application/pdf' // Default a PDF para SMS-Platform
        });

        // 4. Generación de URL firmada (Vence en 5 minutos)
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
                userId // Útil para que el front sepa bajo qué ID quedó guardado
            })
        };
    } catch (error) {
        console.error("Error en Signer Lambda:", error);
        
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