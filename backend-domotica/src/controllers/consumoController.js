const Consumo = require('../models/Consumo');
const Nodo = require('../models/Nodo');
const Alerta = require('../models/Alerta');

// Memoria ultra-rápida (RAM) para las tarjetas en vivo del HMI
const memoriaEnVivo = {};
// Memoria volátil (RAM) para controlar el cronómetro de guardado por cada tablero físico
const ultimosGuardados = {};

// Función para que el ESP32 inyecte los datos eléctricos y el servidor revise alarmas
exports.registrarConsumo = async (req, res) => {
    try {
        const mac_address = req.body.mac_address;
        const ahora = Date.now();

        // Guardamos la foto instantánea en la RAM para el HMI en vivo
        memoriaEnVivo[req.body.circuit_id] = req.body;
        
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

        // Si pasaron 60,000 milisegundos (1 min) para no saturar MongoDB
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

// =========================================================================
// ---> MODIFICADA: CÁLCULO DE EFICIENCIA ENERGÉTICA POR PERIODOS (EMS) <---
// =========================================================================
exports.obtenerMetricasConsumo = async (req, res) => {
    try {
        // 1. Buscamos la lectura más reciente del medidor para saber el acumulado actual
        const ultimoDato = await Consumo.findOne().sort({ timestamp: -1 });

        if (!ultimoDato) {
            const ceroPeriodo = { energia_kwh: 0, costo_cop: 0 };
            return res.status(200).json({ hoy: ceroPeriodo, semana: ceroPeriodo, mes: ceroPeriodo });
        }

        const circuitId = ultimoDato.circuit_id;
        const energiaActualWh = ultimoDato.energy || 0;

        // 2. Establecer las fronteras de tiempo
        const ahora = new Date();

        const inicioHoy = new Date(ahora);
        inicioHoy.setHours(0, 0, 0, 0);

        const inicioSemana = new Date(ahora);
        const diaSemana = inicioSemana.getDay(); 
        const distanciaALunes = diaSemana === 0 ? 6 : diaSemana - 1; 
        inicioSemana.setDate(inicioSemana.getDate() - distanciaALunes);
        inicioSemana.setHours(0, 0, 0, 0);

        const inicioMes = new Date(ahora);
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);

        // ---> LA CORRECCIÓN CLAVE: Convertimos a String ISO para que MongoDB lo pueda leer
        const strHoy = inicioHoy.toISOString();
        const strSemana = inicioSemana.toISOString();
        const strMes = inicioMes.toISOString();

        // 3. Consultar el primer dato almacenado usando el texto ISO
        const primerDatoHoy = await Consumo.findOne({ circuit_id: circuitId, timestamp: { $gte: strHoy } }).sort({ timestamp: 1 });
        const primerDatoSemana = await Consumo.findOne({ circuit_id: circuitId, timestamp: { $gte: strSemana } }).sort({ timestamp: 1 });
        const primerDatoMes = await Consumo.findOne({ circuit_id: circuitId, timestamp: { $gte: strMes } }).sort({ timestamp: 1 });

        // 4. Calcular el diferencial de energía consumida (Delta Wh)
        const valorInicialHoy = primerDatoHoy ? primerDatoHoy.energy : energiaActualWh;
        const valorInicialSemana = primerDatoSemana ? primerDatoSemana.energy : energiaActualWh;
        const valorInicialMes = primerDatoMes ? primerDatoMes.energy : energiaActualWh;

        const whHoy = energiaActualWh - valorInicialHoy;
        const whSemana = energiaActualWh - valorInicialSemana;
        const whMes = energiaActualWh - valorInicialMes;

        // 5. Convertir a Kilovatios-hora (kWh)
        const kwhHoy = Math.max(0, whHoy / 1000);
        const kwhSemana = Math.max(0, whSemana / 1000);
        const kwhMes = Math.max(0, whMes / 1000);

        // Costo base de EMSA
        const TARIFA_KWH_COP = 850; 

        // 6. Retornar con 4 DECIMALES para cargas pequeñas
        res.status(200).json({
            hoy: {
                energia_kwh: parseFloat(kwhHoy.toFixed(4)),
                costo_cop: Math.round(kwhHoy * TARIFA_KWH_COP)
            },
            semana: {
                energia_kwh: parseFloat(kwhSemana.toFixed(4)),
                costo_cop: Math.round(kwhSemana * TARIFA_KWH_COP)
            },
            mes: {
                energia_kwh: parseFloat(kwhMes.toFixed(4)),
                costo_cop: Math.round(kwhMes * TARIFA_KWH_COP)
            }
        });

    } catch (error) {
        console.error('[Error de Métricas EMS]:', error);
        res.status(500).json({ error: 'Falla al procesar el cálculo de consumo por ventanas de tiempo' });
    }
};

// =========================================================================
// ---> NUEVA FUNCIÓN: LEER MEMORIA ULTRA-RÁPIDA (RAM) PARA EL HMI EN VIVO <---
// =========================================================================
exports.obtenerEnVivo = (req, res) => {
    try {
        const { idCircuito } = req.params;
        const datoRapido = memoriaEnVivo[idCircuito];

        if (!datoRapido) {
            // Si el servidor se acaba de reiniciar y el ESP32 no ha transmitido, mandamos null sin romper nada
            return res.status(200).json(null);
        }

        // Retorna inmediatamente el dato alojado en la memoria RAM del servidor
        res.status(200).json(datoRapido);
    } catch (error) {
        console.error('[Error al leer RAM]:', error);
        res.status(500).json({ error: 'Falla crítica al leer el bus de tiempo real en RAM' });
    }
};