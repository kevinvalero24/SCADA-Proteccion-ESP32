const mongoose = require('mongoose');

// 1. Primero definimos el "molde" de los breakers físicos (Circuitos)
const circuitoSchema = new mongoose.Schema({
    circuit_id: { type: String, required: true }, // Ej: "breaker_01"
    name: { type: String, required: true },       // Ej: "Iluminación Sala"
    relay_pin: { type: Number, required: true },  // El pin del ESP32 conectado al optoacoplador
    state: { type: Boolean, default: false },     // true = Encendido, false = Apagado
    alert_threshold_watts: { type: Number, default: 0 } // 0 significa que la alerta predictiva está desactivada hasta que el usuario la configure
});

// 2. Ahora definimos el "molde" del ESP32 principal que contiene esos circuitos
const nodoSchema = new mongoose.Schema({
    mac_address: { type: String, required: true, unique: true }, // La cédula del ESP32, no se puede repetir
    name: { type: String, required: true },                      // Ej: "Tablero Principal Piso 1"
    status: { type: String, enum: ['online', 'offline'], default: 'offline' }, // Solo permite estos dos valores
    last_seen: { type: Date, default: Date.now },                // Guarda la fecha y hora exacta
    circuits: [circuitoSchema]                                   // Aquí anidamos la lista de circuitos que creamos arriba
}, {
    timestamps: true // Esto es magia de Mongoose: crea automáticamente la fecha de creación y de última actualización
});

// 3. Exportamos el modelo para poder usarlo en otras partes del servidor
module.exports = mongoose.model('Nodo', nodoSchema);