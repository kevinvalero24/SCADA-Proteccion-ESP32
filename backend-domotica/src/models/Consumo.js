const mongoose = require('mongoose');

const consumoSchema = mongoose.Schema({
    mac_address: { type: String },
    circuit_id: { type: String },
    voltage: { type: Number },
    current: { type: Number },
    power: { type: Number },
    energy: { type: Number },
    frequency: { type: Number },
    power_factor: { type: Number },
    
    // --- VARIABLES DE ESTADO Y COORDINACIÓN DE PROTECCIÓN ---
    alarm_state: { type: Boolean, default: false },
    sensor_error: { type: Boolean, default: false },
    
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Consumo', consumoSchema);