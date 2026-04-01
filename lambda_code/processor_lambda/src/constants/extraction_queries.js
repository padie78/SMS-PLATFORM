const BASE_QUERIES = [
    // --- IDENTIFICACIÓN FISCAL (VENDOR & CUSTOMER) ---
    { Text: "Nombre legal empresa emisora vendedora", Alias: "VENDOR_NAME" },
    { Text: "CIF NIF emisor vendedor", Alias: "VENDOR_TAX_ID" },
    { Text: "CIF NIF DNI cliente receptor", Alias: "CUSTOMER_NIF" },
    { Text: "Nombre o razon social del cliente", Alias: "CUSTOMER_NAME" },
    { Text: "Direccion completa del suministro o cliente", Alias: "ADDRESS" },

    // --- DATOS DE LA TRANSACCIÓN ---
    { Text: "Numero de factura serie", Alias: "INVOICE_ID" },
    { Text: "Importe total factura", Alias: "TOTAL_AMOUNT" },
    { Text: "Base imponible importe neto", Alias: "NET_AMOUNT" },
    { Text: "Importe total IVA o taxes", Alias: "TAX_AMOUNT" },
    { Text: "Simbolo moneda Euro", Alias: "CURRENCY" },
    { Text: "Metodo de pago o IBAN", Alias: "PAYMENT_METHOD" },

    // --- TEMPORALIDAD Y GEOGRAFÍA ---
    { Text: "Fecha emision factura", Alias: "INVOICE_DATE" },
    { Text: "Fecha inicio periodo despues de Del", Alias: "PERIOD_START" },
    { Text: "Fecha fin periodo despues de al", Alias: "PERIOD_END" },
    { Text: "Codigo postal CP 5 digitos", Alias: "POSTAL_CODE" },
    { Text: "Pais como España", Alias: "COUNTRY" }
];

export const QUERIES_BY_CATEGORY = {
    ELEC: [
        ...BASE_QUERIES,
        { Text: "Codigo CUPS electricidad", Alias: "CUPS" },
        { Text: "Consumo total energia activa kWh", Alias: "KWH_CONSUMPTION" },
        { Text: "Potencia contratada kW", Alias: "CONTRACTED_POWER" },
        { Text: "Importe impuesto electricidad", Alias: "ENERGY_TAX" }
    ],
    GAS: [
        ...BASE_QUERIES,
        { Text: "Codigo CUPS punto suministro GAS", Alias: "SUPPLY_ID" },
        { Text: "Consumo gas metros cubicos m3", Alias: "VALUE" },
        { Text: "Consumo gas energia kWh", Alias: "KWH_VALUE" },
        { Text: "Poder Calorifico Superior PCS", Alias: "TECH_FACTOR" }
    ],
    WATER: [
        ...BASE_QUERIES,
        { Text: "Consumo total agua metros cubicos m3", Alias: "VALUE" },
        { Text: "Numero de contador agua", Alias: "METER_ID" },
        { Text: "Canon de agua o alcantarillado", Alias: "WATER_TAX" }
    ],
    WASTE: [
        ...BASE_QUERIES,
        { Text: "Tipo residuo papel plastico organico", Alias: "WASTE_TYPE" },
        { Text: "Peso neto kg toneladas", Alias: "VALUE" },
        { Text: "Metodo tratamiento reciclaje vertedero incineracion", Alias: "TREATMENT_METHOD" },
        { Text: "Codigo LER residuo", Alias: "LER_CODE" } // Código de Lista Europea de Residuos
    ],
    LOGISTICS: [
        ...BASE_QUERIES,
        { Text: "Matricula vehiculo o ID flota", Alias: "VEHICLE_ID" },
        { Text: "Distancia total recorrida km", Alias: "DISTANCE" },
        { Text: "Tipo combustible diesel gasolina", Alias: "FUEL_TYPE" },
        { Text: "Peso carga transportada", Alias: "WEIGHT" }
    ],
    STATIONARY_COMBUSTION: [
        ...BASE_QUERIES,
        { Text: "Tipo combustible diesel gasoleo propano natural", Alias: "FUEL_TYPE" },
        { Text: "Cantidad neta litros kg m3", Alias: "VALUE" },
        { Text: "ID caldera o deposito", Alias: "EQUIPMENT_ID" }
    ],
    REFRIGERANTS: [
        ...BASE_QUERIES,
        { Text: "Gas refrigerante fluorado R410A R134a R32", Alias: "GAS_TYPE" },
        { Text: "Cantidad carga gas kg", Alias: "VALUE" },
        { Text: "Motivo recarga fuga mantenimiento", Alias: "SERVICE_TYPE" }
    ],
    FLIGHTS: [
        ...BASE_QUERIES,
        { Text: "Ruta origen destino codigos IATA", Alias: "ROUTE" },
        { Text: "Clase cabina Economy Business First", Alias: "TRAVEL_CLASS" },
        { Text: "Nombre pasajero completo", Alias: "PASSENGER_NAME" },
        { Text: "Localizador reserva PNR", Alias: "BOOKING_REF" }
    ],
    OTHERS: [...BASE_QUERIES]
};

export default { QUERIES_BY_CATEGORY };