export const buildGoldenRecord = (partitionKey, s3Key, aiData, footprint) => {
    const timestamp = new Date().toISOString();
    
    return {
        PK: partitionKey, // Ejemplo: ORG#ID_DE_LA_EMPRESA
        SK: `INV#${aiData.extracted_data?.invoice?.date || '0000-00-00'}#${s3Key}`,
        
        // Datos de Negocio
        vendor_name: aiData.extracted_data?.vendor?.name || "Unknown",
        invoice_number: aiData.extracted_data?.invoice?.number || "N/A",
        total_amount: aiData.extracted_data?.amounts?.total || 0,
        currency: aiData.extracted_data?.amounts?.currency || "EUR",
        
        // Datos de Sostenibilidad (CORE)
        total_co2e_kg: footprint.total_kg,
        category: aiData.category,
        
        // --- EL RESULT ARRAY (AUDIT TRAIL) ---
        // Esto permite ver el desglose línea por línea en el Dashboard
        emissions_breakdown: footprint.items, 
        
        // Metadatos de proceso
        processed_at: timestamp,
        s3_reference: s3Key,
        status: "PROCESSED_SUCCESS"
    };
};

export default { buildGoldenRecord };