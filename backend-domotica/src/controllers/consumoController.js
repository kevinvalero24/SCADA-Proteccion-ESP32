const Consumo = require('../models/Consumo');
const Nodo = require('../models/Nodo');
const Alerta = require('../models/Alerta');

// Función para que el ESP32 inyecte los datos eléctricos y el servidor revise alarmas
exports.registrarConsumo = async (req, res) => {
    try {
        // 1. Guardar la lectura normal (Lo que ya hacíamos)
        const nuevaLectura = new Consumo(req.body);
        await nuevaLectura.save();

        let alertaGenerada = null; // Variable para avisar si hubo peligro

        // 2. LA NUEVA INTELIGENCIA: Buscar el circuito y verificar el límite
        const nodo = await Nodo.findOne({ mac_address: req.body.mac_address });
        
        if (nodo) {
            // Buscamos el circuito específico dentro del arreglo del tablero
            const circuito = nodo.circuits.find(c => c.circuit_id === req.body.circuit_id);

            // Verificamos: ¿Existe el circuito? ¿Tiene límite configurado (> 0)? ¿La potencia lo superó?
            if (circuito && circuito.alert_threshold_watts > 0 && req.body.power > circuito.alert_threshold_watts) {
                
                // 3. Crear y guardar la notificación de sobreconsumo
                const nuevaAlerta = new Alerta({
                    mac_address: req.body.mac_address,
                    circuit_id: req.body.circuit_id,
                    mensaje: `¡Pico de consumo detectado! Registrado: ${req.body.power}W (Límite: ${circuito.alert_threshold_watts}W)`,
                    valor_registrado: req.body.power
                });

                await nuevaAlerta.save();
                alertaGenerada = nuevaAlerta; // Guardamos la alerta para enviarla en la respuesta
            }
        }

        // 4. Responder al sistema
        res.status(201).json({
            mensaje: 'Lectura eléctrica procesada',
            datos: nuevaLectura,
            alerta: alertaGenerada // Será 'null' si todo está normal, o mostrará el JSON de peligro
        });
    } catch (error) {
        res.status(400).json({
            mensaje: 'Error al procesar la lectura',
            error: error.message
        });
    }
};
// Función para obtener el historial de un circuito específico (Para las gráficas en Angular)
exports.obtenerHistorial = async (req, res) => {
    try {
        const { idCircuito } = req.params; // Capturamos qué breaker queremos revisar

        // Buscamos, ordenamos por fecha (el más reciente primero) y limitamos a 50 datos
        const historial = await Consumo.find({ circuit_id: idCircuito })
                                       .sort({ timestamp: -1 })
                                       .limit(50);

        res.status(200).json(historial);
    } catch (error) {
        res.status(500).json({
            mensaje: 'Error al consultar el historial de telemetría',
            error: error.message
        });
    }
};