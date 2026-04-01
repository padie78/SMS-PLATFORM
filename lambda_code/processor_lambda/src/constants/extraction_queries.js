const BASE_QUERIES = [
    // --- AUDITORÍA FINANCIERA Y FISCAL ---
    { Text: "Cual es el nombre de la empresa emisora como ELEIA", Alias: "VENDOR_NAME" },
    { Text: "Cual es el CIF o NIF del emisor", Alias: "VENDOR_TAX_ID" },
    { Text: "Cual es el NIF o DNI del cliente", Alias: "CUSTOMER_NIF" },
    { Text: "Cual es el Numero de Factura", Alias: "INVOICE_ID" },
    { Text: "Cual es el importe de Total factura", Alias: "TOTAL_AMOUNT" },
    { Text: "Cual es el importe de la base imponible", Alias: "NET_AMOUNT" },
    { Text: "Cual es el simbolo de moneda o Euro", Alias: "CURRENCY" },

    // --- TEMPORALIDAD Y GEOGRAFÍA ---
    { Text: "Cual es la Fecha de Emision", Alias: "INVOICE_DATE" },
    { Text: "Cual es la fecha de inicio despues de la palabra Del", Alias: "PERIOD_START" },
    { Text: "Cual es la fecha de fin despues de la palabra al", Alias: "PERIOD_END" },
    { Text: "Cual es el codigo postal de 5 digitos CP", Alias: "POSTAL_CODE" },
    { Text: "Cual es el nombre del pais", Alias: "COUNTRY" }
];

export const QUERIES_BY_CATEGORY = {
    ELEC: [
        ...BASE_QUERIES,
        { Text: "Cual es el consumo total en kWh", Alias: "KWH_CONSUMPTION" },
        { Text: "Cual es el codigo CUPS", Alias: "CUPS" }
    ],
    GAS: [
        ...BASE_QUERIES,
        { Text: "Cual es el CUPS o ID de punto de suministro de GAS", Alias: "SUPPLY_ID" },
        { Text: "Cual es el consumo de gas en m3", Alias: "VALUE" },
        { Text: "Cual es el Poder Calorifico Superior PCS", Alias: "TECH_FACTOR" }
    ],
    LOGISTICS: [
        ...BASE_QUERIES,
        { Text: "Cual es la matricula o ID del vehiculo", Alias: "VEHICLE_ID" },
        { Text: "Cual es la distancia total recorrida", Alias: "DISTANCE" },
        { Text: "Cual es el peso de la carga", Alias: "WEIGHT" },
        { Text: "Cual es el tipo de combustible usado", Alias: "FUEL_TYPE" }
    ],
    WASTE: [
        ...BASE_QUERIES,
        { Text: "Cual es el tipo de residuo como Papel Plastico Peligroso Organico", Alias: "WASTE_TYPE" },
        { Text: "Cual es el peso total en kilogramos o toneladas", Alias: "VALUE" },
        { Text: "Cual es el metodo de eliminacion como Reciclaje Vertedero Incineracion", Alias: "TREATMENT_METHOD" },
        { Text: "Cual es el tamaño o volumen del contenedor", Alias: "CONTAINER_VOLUME" }
    ],
    WATER: [
        ...BASE_QUERIES,
        { Text: "Cual es el consumo total de agua en metros cubicos m3", Alias: "VALUE" },
        { Text: "Cual es la referencia del contador o ID de suministro de agua", Alias: "SUPPLY_ID" },
        { Text: "Cual es el desglose de costes de agua potable vs alcantarillado", Alias: "SEWAGE_BREAKDOWN" }
    ],
    STATIONARY_COMBUSTION: [
        ...BASE_QUERIES,
        { Text: "Cual es el tipo de combustible como Diesel Gasoleo Propano Pellets", Alias: "FUEL_TYPE" },
        { Text: "Cual es la cantidad en Litros o kg", Alias: "VALUE" },
        { Text: "Cual es el ID del tanque o equipo recargado", Alias: "EQUIPMENT_ID" }
    ],
    REFRIGERANTS: [
        ...BASE_QUERIES,
        { Text: "Cual es el nombre del gas refrigerante como R410A R134a R32", Alias: "GAS_TYPE" },
        { Text: "Cual es la cantidad de gas recargada en kg", Alias: "VALUE" },
        { Text: "Cual es el motivo del servicio como Fuga Mantenimiento anual", Alias: "SERVICE_TYPE" },
        { Text: "Cual es el ID de la unidad de refrigeracion o sistema HVAC", Alias: "UNIT_ID" }
    ],
    FLIGHTS: [
        ...BASE_QUERIES,
        { Text: "Cual es el origen y destino del vuelo con codigos IATA", Alias: "ROUTE" },
        { Text: "Cual es la clase de viaje como Economy Business First", Alias: "TRAVEL_CLASS" },
        { Text: "Cual es el nombre del pasajero", Alias: "PASSENGER_NAME" },
        { Text: "Es un billete de ida o de ida y vuelta", Alias: "TRIP_TYPE" }
    ],
    OTHERS: [
        ...BASE_QUERIES,
    ]
};

export default { QUERIES_BY_CATEGORY };