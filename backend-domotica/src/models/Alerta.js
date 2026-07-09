const mongoose = require('mongoose');

const alertaSchema = new mongoose.Schema({
    mac_address: { type: String, required: true },
    circuit_id: { type: String, required: true },
    tipo: { type: String, default: 'sobreconsumo' }, // Por si a futuro quieres añadir alertas de "bajo voltaje" o "corte"
    mensaje: { type: String, required: true },       // Ej: "Consumo anormal detectado: 2500W"
    valor_registrado: { type: Number, required: true }, // El valor exacto que disparó la alarma
    leida: { type: Boolean, default: false },        // Para que Angular sepa si ya el usuario vio la notificación
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Alerta', alertaSchema);