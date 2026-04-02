export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const timestamp = new Date().toISOString();
    const invoiceDate = aiData.extracted_data?.invoice?.date || "0000-00-00";
    
    // 1. Extraer solo el nombre del archivo (ej: 1775123489640-factura.jpg)
    // Esto quita "uploads/f3d4f8a2.../"
    const fileName = s3Key.split('/').pop();

    const [year, month] = invoiceDate.split('-');
    const currentYear = year || new Date().getFullYear().toString();
    const currentMonth = month || (new Date().getMonth() + 1).toString().padStart(2, '0');

    return {
        PK: partitionKey,
        // 2. Nueva SK optimizada
        SK: `INV#${invoiceDate}#${fileName}`,
        
        analytics_dims: {
            year: currentYear,
            month: `M#${currentMonth}`,
            facility_id: "MAIN_PLANT",
            category: aiData.category || "ELEC"
        },

        metrics: {
            co2e_tons: footprint.total_kg / 1000,
            consumption_value: aiData.extracted_data?.amounts?.total || 0,
            co2e_kg: footprint.total_kg
        },

        vendor_name: aiData.extracted_data?.vendor?.name || "Unknown",
        invoice_number: aiData.extracted_data?.invoice?.number || "N/A",
        currency: aiData.extracted_data?.amounts?.currency || "EUR",
        
        emissions_breakdown: footprint.items,
        
        processed_at: timestamp,
        s3_reference: s3Key, // Mantenemos el path completo aquí por si necesitas descargar el archivo luego
        status: "PROCESSED_SUCCESS"
    };
};