const CLIMATIQ_API_KEY = "2E44QNZJMX5X5B6EM43E88KRZ8"; 
const DATA_VERSION = "^32"; // Esta versión ahora es requerida en SEARCH también
const BASE_URL = "https://api.climatiq.io/data/v1";

/**
 * Explorador actualizado con data_version
 */
async function exploreFreeActivities(query = "") {
    console.log(`---------- [CLIMATIQ EXPLORER: PUBLIC FACTORS] ----------`);

    try {
        // Añadimos data_version a la URL del explorador
        let url = `${BASE_URL}/search?access_type=public&results_per_page=100&data_version=${DATA_VERSION}`;
        
        if (query) url += `&query=${encodeURIComponent(query)}`;

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Search failed");

        console.log(`=== [TOTAL PUBLIC FACTORS FOUND: ${data.results?.length || 0}] ===`);
        
        data.results?.forEach((f, i) => {
            console.log(`${i+1}. [${f.activity_id}] - ${f.name} (${f.region})`);
        });

        return data.results || [];
    } catch (err) {
        console.error("❌ [EXPLORER_ERROR]:", err.message);
        return [];
    }
}

/**
 * Helper de búsqueda actualizado con data_version
 */
async function callClimatiqSearch(query) {
    // Es vital incluir data_version para que la API no devuelva el error 'missing field'
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&access_type=public&limit=15&data_version=${DATA_VERSION}`;
    
    console.log(`[DEBUG] Calling PUBLIC Search with Version ${DATA_VERSION}`);
    
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CLIMATIQ_API_KEY}` }
    });
    return await res.json();
}

module.exports = { 
    calculateInClimatiq, // Asegúrate de que esta use callClimatiqSearch internamente
    exploreFreeActivities 
};