const Nodo = require('../models/Nodo');

// 1. Función para registrar un tablero nuevo en la topología
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

// 2. Función para consultar todos los ESP32 y sus circuitos (Carga la topología en Angular)
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

// 3. Función dinámica para actualizar CUALQUIER parámetro de un circuito (estado o límite de alerta)
exports.actualizarEstadoCircuito = async (req, res) => {
    try {
        const { idNodo, idCircuito } = req.params; 
        
        // Creamos un "paquete" de actualización inteligente
        const camposAActualizar = {};

        // Si el JSON trae la orden de cambiar el estado (true/false), lo agregamos
        if (req.body.state !== undefined) {
            camposAActualizar["circuits.$.state"] = req.body.state;
        }

        // Si el JSON trae un nuevo límite de alerta, aseguramos que se guarde como NÚMERO puro
        if (req.body.alert_threshold_watts !== undefined) {
            camposAActualizar["circuits.$.alert_threshold_watts"] = Number(req.body.alert_threshold_watts);
        }

        // Buscamos el circuito por ID de Nodo e ID de Circuito y le inyectamos los cambios
        const nodoActualizado = await Nodo.findOneAndUpdate(
            { _id: idNodo, "circuits.circuit_id": idCircuito }, 
            { $set: camposAActualizar }, // <--- Mantiene tu excelente lógica dinámica
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