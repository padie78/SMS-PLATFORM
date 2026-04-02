export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const timestamp = new Date().toISOString();
    
    // 1. Extraemos los datos clave de la IA
    const invoiceDate = aiData.extracted_data?.invoice?.date || "0000-00-00";
    const invoiceNum = aiData.extracted_data?.invoice?.number || "NO-NUMBER";
    
    // 2. Limpiamos el Invoice Number (quitamos espacios/caracteres raros para la SK)
    const cleanInvoiceNum = invoiceNum.replace(/[^a-zA-Z0-9]/g, '-');

    // 3. Extraemos el timestamp/ID del nombre del archivo S3
    // Si el archivo es "1775123728502-factura.jpg", esto saca "1775123728502"
    const s3Id = s3Key.split('/').pop().split('-')[0];

    return {
        PK: partitionKey,
        // 🚀 SK DEFINITIVA: Orden cronológico + Referencia Legal + Unicidad Técnica
        SK: `INV#${invoiceDate}#${cleanInvoiceNum}#${s3Id}`,
        
        // ... el resto del objeto igual ...
        analytics_dims: {
            year: invoiceDate.split('-')[0] || "0000",
            month: `M#${invoiceDate.split('-')[1] || "00"}`,
            facility_id: "MAIN_PLANT",
            category: aiData.category || "ELEC"
        },
        // ...
    };
};