// 1. Importación de las librerías que se instalaron
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // <-- NUEVA LÍNEA: Requerido para el Módulo de Mantenimiento
require('dotenv').config(); // Carga las variables del archivo .env
const conectarDB = require('./src/config/db'); // Importamos la conexión

// 2. Inicialización de la aplicación
const app = express();

// Ejecutamos la conexión a la base de datos
conectarDB();

// 3. Middlewares (Configuraciones base)
app.use(cors()); // Permite que tu frontend en Angular se conecte sin bloqueos de seguridad
app.use(express.json()); // Le enseña al servidor a leer formatos JSON (vital para el ESP32)

// =========================================================================
// ---> NUEVO MÓDULO INTEGRADO: CONSOLIDACIÓN Y LIMPIEZA CÍCLICA (SCADA) <---
// =========================================================================
async function consolidarYLimpiarDatos() {
  try {
    console.log('\n[Mantenimiento SCADA] Iniciando ciclo de consolidación y depuración...');
    const db = mongoose.connection;
    
    // Verificación de seguridad: si la base de datos no está lista, saltamos el ciclo
    if (db.readyState !== 1) {
      console.log('[Mantenimiento SCADA] Base de datos no lista. Se reintentará en el próximo ciclo.');
      return;
    }

    // ADVERTENCIA DE INGENIERÍA: Mongoose pluraliza automáticamente los modelos. 
    // Si tu modelo de telemetría se llama 'Consumo', la colección en MongoDB es 'consumos'.
    // Si notas que no borra, verifica en MongoDB Compass si tu colección se llama 'telemetrias' o similar.
    const coleccionTelemetria = db.collection('consumos'); 
    const coleccionHistoricos = db.collection('historicos_mensuales');

    // CONFIGURACIÓN DE RETENCIÓN: Conservamos ráfagas detalladas de los últimos 7 días
    const limiteRetencion = new Date();
    limiteRetencion.setDate(limiteRetencion.getDate() - 7);

    // PASO 1: AGREGACIÓN (Compresor de datos)
    // Buscamos todos los registros anteriores a 7 días y los agrupamos por Año, Mes y Dispositivo
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
          energiaMaxima: { $max: "$energy" }, // El PZEM es un contador acumulativo; el valor máximo es el consumo total de ese mes
          totalMuestras: { $sum: 1 }
        }
      }
    ]).toArray();

    if (datosParaConsolidar.length === 0) {
      console.log('[Mantenimiento SCADA] No se encontraron lecturas antiguas para depurar. Base de datos optimizada.');
      return;
    }

    // PASO 2: RESPALDO HISTÓRICO
    // Guardamos o actualizamos el resumen consolidado en la nueva colección
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
            // Convertimos la energía del PZEM (Wh) a Kilovatios-Hora (kWh) dividiendo por 1000
            energia_mensual_kwh: parseFloat((registro.energiaMaxima / 1000).toFixed(2)), 
            muestras_procesadas: registro.totalMuestras,
            ultima_actualizacion: new Date()
          }
        },
        { upsert: true } // Si el mes no existe lo crea; si existe, actualiza los kWh acumulados
      );
    }
    console.log(`[Mantenimiento SCADA] Éxito: Se consolidaron ${datosParaConsolidar.length} bloques mensuales en el historiador.`);

    // PASO 3: LA PURGA (Liberación de espacio en disco)
    // Una vez asegurado el consolidado, borramos las millones de ráfagas viejas de la colección principal
    const resultadoBorrado = await coleccionTelemetria.deleteMany({
      timestamp: { $lt: limiteRetencion }
    });

    console.log(`[Mantenimiento SCADA] Purga completada. Se eliminaron ${resultadoBorrado.deletedCount} ráfagas detalladas del historial activo.\n`);

  } catch (error) {
    console.error('[Mantenimiento SCADA] Error crítico en el módulo de limpieza:', error);
  }
}

// PROGRAMACIÓN DEL TEMPORIZADOR AUTOMÁTICO (Rutina de fondo)
// Ejecución 1: Se dispara automáticamente 5 segundos después de encender el servidor (Ideal para pruebas en caliente)
setTimeout(consolidarYLimpiarDatos, 5000);

// Ejecución 2: Se repite en bucle cerrado cada 24 horas para mantener el servidor limpio
setInterval(consolidarYLimpiarDatos, 24 * 60 * 60 * 1000);
// =========================================================================


// 4. Rutas de la API
app.get('/api/estado', (req, res) => {
  res.json({
    mensaje: '¡Servidor del proyecto domótico funcionando al 100%!',
    estado: 'Online'
  });
});

app.use('/api/nodos', require('./src/routes/nodoRoutes'));
// Conectamos la ruta de telemetría donde el ESP32 inyecta los datos
app.use('/api/telemetria', require('./src/routes/consumoRoutes'));

// 5. Configuración del puerto
const PORT = process.env.PORT || 3000;

// 6. Encendido del servidor
app.listen(PORT, () => {
  console.log(`\n Servidor corriendo exitosamente en el puerto: ${PORT}`);
  console.log(` Esperando el próximo paso: Conectar a MongoDB...`);
});