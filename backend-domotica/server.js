// 1. Importación de las librerías
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config(); 
const conectarDB = require('./src/config/db');

// ---> NUEVAS LIBRERÍAS PARA EL TÚNEL BIDIRECCIONAL (WEBSOCKETS) <---
const http = require('http');
const { Server } = require('socket.io');

// 2. Inicialización de la aplicación y la antena de radio
const app = express();
const server = http.createServer(app); // Envolvemos Express en un servidor HTTP puro

// Configuramos la antena Socket.io para que acepte conexiones de Angular y del ESP32
const io = new Server(server, {
  cors: { origin: '*' }
});

conectarDB();

app.use(cors()); 
app.use(express.json()); 

// =========================================================================
// ---> CEREBRO DE MANDO BIDIRECCIONAL (MEMORIA DEL PLC) <---
// =========================================================================
// Esta variable global guarda la última orden del operador en el HMI
let estadoMando = {
  modo: 'manual',    // Puede ser 'manual' o 'horario'
  forzar_rele: true, // true = Cerrar contactor (ON), false = Abrir contactor (OFF)
  hora_inicio: '',   // Ejemplo: '18:00'
  hora_fin: ''       // Ejemplo: '22:00'
};

// Escuchando la frecuencia de radio (Conexiones en tiempo real)
io.on('connection', (socket) => {
  console.log(`[Radio SCADA] Nueva conexión en tiempo real establecida. ID: ${socket.id}`);

  // Cuando alguien se conecta (Angular o ESP32), le mandamos el estado actual inmediatamente
  socket.emit('estado_mando', estadoMando);

  // Escuchamos cuando el operador presiona el botón en Angular
  socket.on('comando_operador', (nuevaOrden) => {
    // Actualizamos el cerebro del servidor
    estadoMando = { ...estadoMando, ...nuevaOrden };
    console.log(`[Mando SCADA] Orden recibida del HMI: Modo ${estadoMando.modo.toUpperCase()} | Relé: ${estadoMando.forzar_rele ? 'ON' : 'OFF'}`);
    
    // Retransmitimos la orden por radio a TODOS los conectados (Especialmente al ESP32)
    io.emit('estado_mando', estadoMando);
  });

  socket.on('disconnect', () => {
    console.log(`[Radio SCADA]  Conexión perdida. ID: ${socket.id}`);
  });
});
// =========================================================================
// =========================================================================
// ---> MÓDULO DE CONTROL HORARIO (TEMPORIZADOR PLC) <---
// =========================================================================
function evaluarControlHorario() {
  // 1. Si estamos en modo manual o faltan horas por configurar, ignoramos el ciclo
  if (estadoMando.modo !== 'horario' || !estadoMando.hora_inicio || !estadoMando.hora_fin) {
    return;
  }

  // 2. Extraemos la hora exacta del servidor (Ajustada a la zona horaria de Colombia)
  // Esto garantiza que aunque el servidor esté en la nube (UTC), el horario sea el de Villavicencio
  const ahora = new Date();
  const opciones = { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false };
  // Nos devuelve un string limpio tipo "08:30" o "18:45"
  const horaActualStr = ahora.toLocaleTimeString('es-CO', opciones).slice(0, 5);

  // 3. Lógica de conmutación (Disparo en el minuto exacto)
  // Si la hora coincide con el inicio y el contactor está apagado -> ENCENDER
  if (horaActualStr === estadoMando.hora_inicio && estadoMando.forzar_rele === false) {
    estadoMando.forzar_rele = true;
    console.log(`\n[Temporizador] ⏰ ¡Hora de INICIO alcanzada (${horaActualStr})! Energizando contactor.`);
    io.emit('estado_mando', estadoMando); // Retransmitimos por radio a todos (ESP32 y HMI)
  }
  // Si la hora coincide con el fin y el contactor está encendido -> APAGAR
  else if (horaActualStr === estadoMando.hora_fin && estadoMando.forzar_rele === true) {
    estadoMando.forzar_rele = false;
    console.log(`\n[Temporizador] ⏰ ¡Hora de FIN alcanzada (${horaActualStr})! Desenergizando contactor.`);
    io.emit('estado_mando', estadoMando); // Retransmitimos por radio a todos (ESP32 y HMI)
  }
}

// El motor del servidor revisará el reloj cada 10 segundos
setInterval(evaluarControlHorario, 10000);
// =========================================================================

// =========================================================================
// ---> MÓDULO INTEGRADO: CONSOLIDACIÓN Y LIMPIEZA CÍCLICA (SCADA) <---
// =========================================================================
async function consolidarYLimpiarDatos() {
  try {
    console.log('\n[Mantenimiento SCADA] Iniciando ciclo de consolidación y depuración...');
    const db = mongoose.connection;
    
    if (db.readyState !== 1) {
      console.log('[Mantenimiento SCADA] Base de datos no lista. Se reintentará en el próximo ciclo.');
      return;
    }

    const coleccionTelemetria = db.collection('consumos'); 
    const coleccionHistoricos = db.collection('historicos_mensuales');

    const limiteRetencion = new Date();
    limiteRetencion.setDate(limiteRetencion.getDate() - 7);

    const datosParaConsolidar = await coleccionTelemetria.aggregate([
      { $match: { timestamp: { $lt: limiteRetencion } } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            mac_address: "$mac_address"
          },
          voltajePromedio: { $avg: "$voltage" },
          corrientePromedio: { $avg: "$current" },
          potenciaPromedio: { $avg: "$power" },
          energiaMaxima: { $max: "$energy" }, 
          totalMuestras: { $sum: 1 }
        }
      }
    ]).toArray();

    if (datosParaConsolidar.length === 0) {
      console.log('[Mantenimiento SCADA] No se encontraron lecturas antiguas para depurar. Base de datos optimizada.');
      return;
    }

    for (const registro of datosParaConsolidar) {
      await coleccionHistoricos.updateOne(
        { 
          year: registro._id.year, 
          month: registro._id.month, 
          mac_address: registro._id.mac_address 
        },
        {
          $set: {
            voltaje_promedio_v: parseFloat(registro.voltajePromedio.toFixed(2)),
            corriente_promedio_a: parseFloat(registro.corrientePromedio.toFixed(4)),
            potencia_promedio_w: parseFloat(registro.potenciaPromedio.toFixed(2)),
            energia_mensual_kwh: parseFloat((registro.energiaMaxima / 1000).toFixed(2)), 
            muestras_procesadas: registro.totalMuestras,
            ultima_actualizacion: new Date()
          }
        },
        { upsert: true } 
      );
    }
    console.log(`[Mantenimiento SCADA] Éxito: Se consolidaron ${datosParaConsolidar.length} bloques mensuales en el historiador.`);

    const resultadoBorrado = await coleccionTelemetria.deleteMany({
      timestamp: { $lt: limiteRetencion }
    });

    console.log(`[Mantenimiento SCADA] Purga completada. Se eliminaron ${resultadoBorrado.deletedCount} ráfagas detalladas del historial activo.\n`);

  } catch (error) {
    console.error('[Mantenimiento SCADA] Error crítico en el módulo de limpieza:', error);
  }
}

setTimeout(consolidarYLimpiarDatos, 5000);
setInterval(consolidarYLimpiarDatos, 24 * 60 * 60 * 1000);
// =========================================================================


// 4. Rutas de la API
app.get('/api/estado', (req, res) => {
  res.json({
    mensaje: '¡Servidor del proyecto domótico funcionando al 100% con WebSockets!',
    estado: 'Online'
  });
});

app.use('/api/nodos', require('./src/routes/nodoRoutes'));
app.use('/api/telemetria', require('./src/routes/consumoRoutes'));

// 5. Configuración del puerto
const PORT = process.env.PORT || 3000;

// 6. Encendido del servidor (¡AQUÍ CAMBIA APP POR SERVER!)
server.listen(PORT, () => {
  console.log(`\n Servidor y Radio SCADA corriendo exitosamente en el puerto: ${PORT}`);
  console.log(` Esperando el próximo paso: Conectar a MongoDB...`);
});