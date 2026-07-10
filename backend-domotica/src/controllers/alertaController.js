const Alerta = require('../models/Alerta');

// Función para obtener el historial de disparos/eventos (SOE)
exports.obtenerHistorialAlertas = async (req, res) => {
    try {
        // Buscamos todas las alertas, las ordenamos por fecha descendente (-1) y limitamos a los últimos 100 eventos
        // Nota: Asegúrate de que tu modelo 'Alerta' guarde una fecha. Si usas timestamps en Mongoose, será 'createdAt'.
        const alertas = await Alerta.find().sort({ createdAt: -1, timestamp: -1 }).limit(100);
        
        return res.status(200).json(alertas);
    } catch (error) {
        return res.status(500).json({ 
            mensaje: 'Error al consultar el registro de eventos', 
            error: error.message 
        });
    }
};