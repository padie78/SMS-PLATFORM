const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Instanciamos fuera del handler para reutilizar la conexión en "warm starts"
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-central-1" });

exports.handler = async (event) => {
    // 1. Validación defensiva del body
    if (!event.body) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Missing request body" })
        };
    }

    try {
        const { fileName, fileType, clientId } = JSON.parse(event.body);

        // 2. Validación de campos obligatorios para evitar keys "undefined"
        if (!fileName || !clientId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "fileName and clientId are required" })
            };
        }

        // 3. Sanitización básica del nombre del archivo
        const cleanFileName = fileName.replace(/\s+/g, '_').toLowerCase();
        const key = `${clientId}/uploads/${Date.now()}-${cleanFileName}`;

        const command = new PutObjectCommand({
            Bucket: process.env.UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType || 'application/octet-stream'
        });

        // Generamos la URL firmada
        const uploadURL = await getSignedUrl(s3Client, command, { expiresIn: 300 });

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                uploadURL,
                key
            })
        };
    } catch (error) {
        console.error("Error generando Presigned URL:", error);
        
        // No devolvemos el error crudo al cliente por seguridad
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ message: "Internal server error" })
        };
    }
};