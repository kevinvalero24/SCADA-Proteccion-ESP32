const Nodo = require('../models/Nodo');

exports.crearNodo = async (req, res) => {
    try {
        const nuevoNodo = new Nodo(req.body); 
        await nuevoNodo.save(); 
        
        res.status(201).json({ 
            mensaje: 'Nodo y circuitos registrados exitosamente', 
            nodo: nuevoNodo 
        });
    } catch (error) {
        res.status(400).json({ 
            mensaje: 'Error al registrar el nodo', 
            error: error.message 
        });
    }
};
// Función para consultar todos los ESP32 y sus circuitos
exports.obtenerNodos = async (req, res) => {
    try {
        // .find() le dice a Mongo: "Tráeme todo lo que tengas en esta colección"
        const nodos = await Nodo.find(); 
        res.status(200).json(nodos); // 200 OK significa éxito en lectura
    } catch (error) {
        res.status(500).json({ 
            mensaje: 'Error al consultar la base de datos', 
            error: error.message 
        });
    }
};
// Función para actualizar CUALQUIER parámetro de un circuito (estado o límite de alerta)
exports.actualizarEstadoCircuito = async (req, res) => {
    try {
        const { idNodo, idCircuito } = req.params; 
        
        // 1. Creamos un "paquete" de actualización inteligente
        const camposAActualizar = {};

        // Si el JSON trae la orden de cambiar el estado (true/false), lo agregamos
        if (req.body.state !== undefined) {
            camposAActualizar["circuits.$.state"] = req.body.state;
        }

        // Si el JSON trae un nuevo límite de alerta, lo agregamos
        if (req.body.alert_threshold_watts !== undefined) {
            camposAActualizar["circuits.$.alert_threshold_watts"] = req.body.alert_threshold_watts;
        }

        // 2. Buscamos el circuito y le inyectamos solo los campos que detectamos
        const nodoActualizado = await Nodo.findOneAndUpdate(
            { _id: idNodo, "circuits.circuit_id": idCircuito }, 
            { $set: camposAActualizar }, // <--- Aquí está la magia dinámica
            { new: true }                                       
        );

        if (!nodoActualizado) {
            return res.status(404).json({ mensaje: 'No se encontró el tablero o el circuito' });
        }

        res.status(200).json({ 
            mensaje: '¡Circuito actualizado exitosamente!', 
            nodo: nodoActualizado 
        });
    } catch (error) {
        res.status(500).json({ 
            mensaje: 'Error de comunicación al actualizar', 
            error: error.message 
        });
    }
};