const Consumo = require('../models/Consumo');
const Nodo = require('../models/Nodo');
const Alerta = require('../models/Alerta');

// Memoria volátil (RAM) para controlar el cronómetro de guardado por cada tablero físico
const ultimosGuardados = {};

// Función para que el ESP32 inyecte los datos eléctricos y el servidor revise alarmas
exports.registrarConsumo = async (req, res) => {
    try {
        const mac_address = req.body.mac_address;
        const ahora = Date.now();
        
        let alertaGenerada = null; // Variable para avisar si hubo peligro
        let forzarGuardado = false; // Bandera de seguridad (Registro por Evento)

        // 1. LA INTELIGENCIA: Buscar el circuito y verificar el límite PRIMERO
        const nodo = await Nodo.findOne({ mac_address: mac_address });
        
        if (nodo) {
            // Buscamos el circuito específico dentro del arreglo del tablero
            const circuito = nodo.circuits.find(c => c.circuit_id === req.body.circuit_id);

            // Verificamos: ¿Existe el circuito? ¿Tiene límite configurado (> 0)? ¿La potencia lo superó?
            if (circuito && circuito.alert_threshold_watts > 0 && req.body.power > circuito.alert_threshold_watts) {
                
                // Crear y guardar la notificación de sobreconsumo
                const nuevaAlerta = new Alerta({
                    mac_address: mac_address,
                    circuit_id: req.body.circuit_id,
                    mensaje: `¡Pico de consumo detectado! Registrado: ${req.body.power}W (Límite: ${circuito.alert_threshold_watts}W)`,
                    valor_registrado: req.body.power
                });

                await nuevaAlerta.save();
                alertaGenerada = nuevaAlerta; // Guardamos la alerta para enviarla en la respuesta
                
                // REGLA INDUSTRIAL: Si hay un pico, ignoramos el reloj y forzamos el guardado del dato eléctrico
                forzarGuardado = true; 
            }
        }

        // 2. FILTRO DE TIEMPO (Guardar cada 60 segundos O si hubo una alerta crítica)
        const ultimoTiempo = ultimosGuardados[mac_address] || 0;
        let lecturaGuardada = null;

        // Si pasaron 60,000 milisegundos (1 min) o si la bandera de emergencia está activa
        if ((ahora - ultimoTiempo >= 60000) || forzarGuardado) {
            
            // Guardamos la lectura normal en la base de datos
            const nuevaLectura = new Consumo(req.body);
            await nuevaLectura.save();
            lecturaGuardada = nuevaLectura;

            // Reiniciamos el cronómetro de este tablero
            ultimosGuardados[mac_address] = ahora;
        }

        // 3. Responder al sistema (El ESP32 recibe esto de inmediato)
        res.status(201).json({
            // Le avisamos a la consola si el dato se guardó o si solo pasó de largo para el HMI
            mensaje: lecturaGuardada ? 'Lectura guardada en BD y procesada' : 'Lectura procesada en tiempo real',
            datos: req.body, // Enviamos los datos para que el HMI los grafique sin importar si se guardaron o no
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