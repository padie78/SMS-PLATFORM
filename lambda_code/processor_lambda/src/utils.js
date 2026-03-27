function limpiarTexto(texto) {
    // Elimina espacios dobles y caracteres extraños de Textract
    return texto.replace(/\s+/g, ' ').trim();
}

function validarCampos(datos) {
    return datos.cantidad && datos.unidad && datos.tipo_energia;
}

/**
 * Helpers de Transformación
 */
async function downloadFromS3(bucket, key) {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const chunk of response.Body) { chunks.push(chunk); }
    return Buffer.concat(chunks);
}

function buildGoldenRecord(orgId, fileId, key, filename, fileHash, ai, climatiq) {
    const now = new Date().toISOString();
    const [datePart] = now.split('T');
    const year = datePart.split('-')[0];
    const month = datePart.split('-')[1];

    const co2e = Number(climatiq.co2e) || 0;
    const amount = Number(ai.extracted_data.total_amount) || 0;

    return {
        // Referencias internas para la transacción de base de datos
        internal_refs: {
            orgId, year, month, co2e,
            totalAmount: amount,
            serviceType: ai.ai_analysis.service_type || "Unknown"
        },
        // El registro completo que va a la tabla
        full_record: {
            PK: `ORG#${orgId}`,
            SK: `INV#${datePart}#${fileId}`,
            metadata: { filename, s3_key: key, file_hash: fileHash, upload_date: now, status: "PROCESSED" },
            extracted_data: { ...ai.extracted_data, total_amount: amount },
            ai_analysis: { ...ai.ai_analysis, confidence_score: ai.ai_analysis.confidence_score || 0 },
            climatiq_result: { ...climatiq, co2e, timestamp: now },
            analytics_dimensions: {
                period_year: parseInt(year),
                period_month: parseInt(month),
                carbon_intensity: amount > 0 ? parseFloat((co2e / amount).toFixed(5)) : 0,
                sector: "CONSTRUCTION"
            }
        }
    };
}




module.exports = { limpiarTexto, validarCampos, downloadFromS3, buildGoldenRecord };