/**
 * Single Source of Truth para reglas de negocio por categoría.
 *
 * Migrado desde `lambda_code/worker_lambda/src/infrastructure/ai/bedrock_rules.js`.
 */
export interface InvoiceCategoryRule {
  readonly focus: string;
  readonly scope: string;
  readonly strategy: string;
  readonly allowed_units: string;
  readonly metadata: Record<string, string>;
}

export type InvoiceCategoryKey =
  | 'ELEC'
  | 'GAS'
  | 'LOGISTICS'
  | 'WASTE'
  | 'WATER'
  | 'REFRIGERANTS'
  | 'FLEET_FUEL'
  | 'BIOMASS'
  | 'HOTEL'
  | 'CLOUDOPS'
  | 'OTHERS';

export const CATEGORY_RULES: Record<InvoiceCategoryKey, InvoiceCategoryRule> = {
  ELEC: {
    focus:
      'Extract Active Energy (kWh). Ignore monetary values for emission lines. Sum P1, P2, P3 consumption.',
    scope: '2',
    strategy: 'ELECTRICITY',
    allowed_units: 'kWh',
    metadata: {
      meter_id: 'string (CUPS)',
      is_renewable: 'boolean',
      tariff_name: 'string (e.g. 2.0TD)',
      voltage_level: 'string (LOW/MEDIUM/HIGH)',
      is_estimated_reading: 'boolean'
    }
  },
  GAS: {
    focus: 'Extract Natural Gas consumption (kWh or m3). Identify Meter Serial.',
    scope: '1',
    strategy: 'STATIONARY_COMBUSTION',
    allowed_units: 'kWh|m3',
    metadata: {
      meter_id: 'string',
      conversion_factor: 'float',
      pressure_level: 'string',
      is_estimated_reading: 'boolean'
    }
  },
  LOGISTICS: {
    focus: 'Extract Weight (tons) and Distance (km) for Freight/Shipments.',
    scope: '3',
    strategy: 'TRANSPORTATION',
    allowed_units: 'tkm|km|kg|t',
    metadata: {
      weight_tons: 'float',
      distance_km: 'float',
      vehicle_plate: 'string',
      fuel_type: 'string',
      euro_standard: 'string (e.g. EURO_6)'
    }
  },
  REFRIGERANTS: {
    focus: 'Identify F-Gas type and recharge weight for HVAC maintenance.',
    scope: '1',
    strategy: 'FUGITIVE_EMISSIONS',
    allowed_units: 'kg|lb',
    metadata: {
      gas_type: 'string (e.g. R-410A, R-134a)',
      recharge_weight_kg: 'float',
      equipment_id: 'string',
      is_leak: 'boolean'
    }
  },
  WASTE: {
    focus: 'Extract waste weight and disposal method.',
    scope: '3',
    strategy: 'WASTE_MANAGEMENT',
    allowed_units: 'kg|t',
    metadata: {
      waste_type: 'string (PAPER, PLASTIC, HAZARDOUS)',
      disposal_method: 'string (RECYCLING, LANDFILL, INCINERATION)',
      weight_kg: 'float'
    }
  },
  WATER: {
    focus: 'Extract water supply consumption (m3) and supplier ID.',
    scope: '3',
    strategy: 'WATER_SUPPLY',
    allowed_units: 'm3',
    metadata: {
      meter_id: 'string',
      contract_reference: 'string'
    }
  },
  FLEET_FUEL: {
    focus: 'Extract fuel quantity (liters) per vehicle and fuel type.',
    scope: '1',
    strategy: 'MOBILE_COMBUSTION',
    allowed_units: 'L',
    metadata: {
      vehicle_plate: 'string',
      fuel_type: 'string',
      odometer_km: 'float'
    }
  },
  BIOMASS: {
    focus: 'Extract biomass mass (kg or t) and source.',
    scope: '1',
    strategy: 'BIOMASS_COMBUSTION',
    allowed_units: 'kg|t',
    metadata: {
      biomass_source: 'string'
    }
  },
  HOTEL: {
    focus: 'Extract nights of stay and city for travel emissions.',
    scope: '3',
    strategy: 'BUSINESS_TRAVEL',
    allowed_units: 'unit',
    metadata: {
      nights: 'int',
      city: 'string'
    }
  },
  CLOUDOPS: {
    focus: 'Extract cloud spend by service for Scope 3 cat. 1 attribution.',
    scope: '3',
    strategy: 'PURCHASED_GOODS',
    allowed_units: 'EUR|USD',
    metadata: {
      cloud_provider: 'string',
      service_id: 'string'
    }
  },
  OTHERS: {
    focus: 'General audit of consumption and accounting data.',
    scope: '3',
    strategy: 'OTHER_INDIRECT',
    allowed_units: 'kWh|m3|L|kg|t|km|unit',
    metadata: {
      service_id: 'string',
      general_description: 'string'
    }
  }
};
