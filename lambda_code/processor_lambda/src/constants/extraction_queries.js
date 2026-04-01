const BASE_QUERIES = [
    // --- AUDITORÍA FINANCIERA Y FISCAL ---
    { Text: "What is the company name (e.g., ELEIA)?", Alias: "VENDOR_NAME" },
    { Text: "What is the CIF or NIF of the vendor (issuer)?", Alias: "VENDOR_TAX_ID" },
    { Text: "What is the NIF/DNI of the customer (client)?", Alias: "CUSTOMER_NIF" },
    { Text: "What is the N° de Factura?", Alias: "INVOICE_ID" },
    { Text: "What is the value for Total factura?", Alias: "TOTAL_AMOUNT" },
    { Text: "What is the base imponible or net amount?", Alias: "NET_AMOUNT" },
    { Text: "What is the currency symbol (e.g., €)?", Alias: "CURRENCY" },

    // --- TEMPORALIDAD Y GEOGRAFÍA ---
    { Text: "What is the Fecha de Emision?", Alias: "INVOICE_DATE" },
    { Text: "What is the billing start date after 'Del'?", Alias: "PERIOD_START" },
    { Text: "What is the billing end date after 'al'?", Alias: "PERIOD_END" },
    { Text: "What is the 5-digit postal code (CP)?", Alias: "POSTAL_CODE" },
    { Text: "What is the country name?", Alias: "COUNTRY" }
];

export const QUERIES_BY_CATEGORY = {
    ELEC: [
        ...BASE_QUERIES,
        { Text: "What is the invoice number or reference?", Alias: "INVOICE_ID" },
        { Text: "What is the total amount to pay with currency symbol?", Alias: "TOTAL_AMOUNT" },
        { Text: "What is the name of the energy company (issuer)?", Alias: "VENDOR_NAME" },
        { Text: "What is the CIF or NIF of the issuer company?", Alias: "VENDOR_TAX_ID" },
        { Text: "What is the consumption in kWh?", Alias: "KWH_CONSUMPTION" },
        { Text: "What is the CUPS code?", Alias: "CUPS" },
        { Text: "What is the invoice date?", Alias: "INVOICE_DATE" }
    ],
    GAS: [
        ...BASE_QUERIES,
        { Text: "What is the CUPS or supply point ID for GAS?", Alias: "SUPPLY_ID" },
        { Text: "What is the gas consumption in m3?", Alias: "VALUE" },
        { Text: "What is the Higher Heating Value (PCS)?", Alias: "TECH_FACTOR" }
    ],
    LOGISTICS: [
        ...BASE_QUERIES,
        { Text: "What is the vehicle license plate or ID?", Alias: "VEHICLE_ID" },
        { Text: "What is the total distance traveled?", Alias: "DISTANCE" },
        { Text: "What is the weight of the load?", Alias: "WEIGHT" },
        { Text: "What is the type of fuel used?", Alias: "FUEL_TYPE" }
    ],
    WASTE: [
        ...BASE_QUERIES,
        { Text: "What is the type of waste (e.g. Paper, Plastic, Hazardous, Organic, Mixed)?", Alias: "WASTE_TYPE" },
        { Text: "What is the total weight in kilograms or tons?", Alias: "VALUE" },
        { Text: "What is the disposal method (e.g. Recycling, Landfill, Incineration, Composting)?", Alias: "TREATMENT_METHOD" },
        { Text: "What is the container size or volume?", Alias: "CONTAINER_VOLUME" }
    ],
    WATER: [
        ...BASE_QUERIES,
        { Text: "What is the total water consumption in cubic meters (m3)?", Alias: "VALUE" },
        { Text: "What is the meter reference or supply point ID for water?", Alias: "SUPPLY_ID" },
        { Text: "What is the breakdown of fresh water vs. sewage costs?", Alias: "SEWAGE_BREAKDOWN" },
        { Text: "Is there a mention of reclaimed or recycled water use?", Alias: "WATER_SOURCE_TYPE" }
    ],
    STATIONARY_COMBUSTION: [
        ...BASE_QUERIES,
        { Text: "What is the type of fuel (e.g. Diesel, Fuel Oil, Propane, Pellets)?", Alias: "FUEL_TYPE" },
        { Text: "What is the quantity in Liters, Gallons or kg?", Alias: "VALUE" },
        { Text: "What is the Net Calorific Value (NCV) or density if mentioned?", Alias: "TECH_SPEC" },
        { Text: "What is the tank or equipment ID being refilled?", Alias: "EQUIPMENT_ID" }
    ],
    REFRIGERANTS: [
        ...BASE_QUERIES,
        { Text: "What is the refrigerant gas name (e.g. R-410A, R-134a, R-32, R-404A)?", Alias: "GAS_TYPE" },
        { Text: "What is the amount of gas recharged or topped up in kg?", Alias: "VALUE" },
        { Text: "What is the reason for service (e.g. Leak repair, Annual maintenance)?", Alias: "SERVICE_TYPE" },
        { Text: "What is the ID of the cooling unit or HVAC system?", Alias: "UNIT_ID" }
    ],
    FLIGHTS: [
        ...BASE_QUERIES,
        { Text: "What is the flight origin and destination (IATA codes)?", Alias: "ROUTE" },
        { Text: "What is the travel class (e.g. Economy, Premium, Business, First)?", Alias: "TRAVEL_CLASS" },
        { Text: "What is the passenger name?", Alias: "PASSENGER_NAME" },
        { Text: "Is it a one-way or round-trip ticket?", Alias: "TRIP_TYPE" }
    ],
    OTHERS: [
        ...BASE_QUERIES,
    ]
};

// --- IMPORTANTE: Exportación por defecto para que funcione con tus importaciones actuales ---
export default { QUERIES_BY_CATEGORY };