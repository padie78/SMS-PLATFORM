// constants/climatiq_catalog.js
module.exports = {
    STRATEGIES: {
        ELEC: {
            activity_id: "electricity-supply_grid_mix-source_supplier_mix", 
            query: "grid_mix",
            unit_type: "energy",
            default_unit: "kWh"
        },
        GAS: {
            activity_id: "fuel-type_natural_gas-fuel_use_na",
            query: "natural_gas",
            unit_type: "energy",
            default_unit: "kWh"
        },
        LOGISTICS: {
            activity_id: "freight_vehicle-vehicle_type_hgv_rigid-fuel_source_diesel-vehicle_weight_gt_17t-percentage_load_avg",
            unit_type: "weightoverdistance",
            default_unit: "t.km"
        },
        FLEET: {
            activity_id: "passenger_vehicle-vehicle_type_car-fuel_source_diesel-engine_size_na-vehicle_age_na-vehicle_weight_na",
            unit_type: "distance",
            default_unit: "km"
        },
        WASTE_PAPER: {
            activity_id: "waste-type_paper-disposal_method_closed_loop",
            unit_type: "weight",
            default_unit: "kg"
        }
    }
};