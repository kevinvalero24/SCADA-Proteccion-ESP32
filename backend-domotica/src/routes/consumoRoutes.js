const express = require('express');
const router = express.Router();
const consumoController = require('../controllers/consumoController');

// =========================================================================
// 1. DESCARGA DE HISTÓRICOS EN CSV (SEMANAL O MENSUAL)
// =========================================================================
router.get('/exportar-csv', async (req, res) => {
  try {
    const Telemetria = require('../models/Consumo'); 
    const tipo = req.query.tipo || 'mensual';
    
    // 1. Calculamos la fecha límite de forma estricta
    const dias = tipo === 'semanal' ? 7 : 30;
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - dias);

    // 2. Filtramos DIRECTAMENTE en MongoDB (Mucho más rápido y eficiente)
    // Buscamos registros donde el 'timestamp' sea Mayor o Igual ($gte) a la fecha límite
    const registros = await Telemetria.find({
      timestamp: { $gte: fechaLimite }
    }).sort({ timestamp: -1 });

    let csvContent = "\uFEFF"; 
    csvContent += "Fecha_Hora;MAC_Address;Circuito;Voltaje_V;Corriente_A;Potencia_W;Energia_kWh;Frecuencia_Hz;Factor_Potencia;Alarma;Error_Sensor\n";

    registros.forEach(reg => {
      let fechaLimpia = 'N/A';
      if (reg.timestamp) {
        // Formateamos la fecha nativa a un formato legible por Excel (YYYY-MM-DD HH:mm:ss)
        fechaLimpia = new Date(reg.timestamp).toISOString().replace('T', ' ').substring(0, 19);
      }

      csvContent += `${fechaLimpia};` +
                    `${reg.mac_address};` +
                    `${reg.circuit_id};` +
                    `${reg.voltage};` +
                    `${reg.current};` +
                    `${reg.power};` +
                    `${reg.energy};` +
                    `${reg.frequency || 0};` +
                    `${reg.power_factor || 0};` +
                    `${reg.alarm_state ? 'SI' : 'NO'};` +
                    `${reg.sensor_error ? 'SI' : 'NO'}\n`;
    });

    const nombreArchivo = tipo === 'semanal' ? 'Reporte_Consumo_Semanal.csv' : 'Reporte_Consumo_Mensual.csv';
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${nombreArchivo}`);
    
    return res.status(200).send(csvContent);
  } catch (error) {
    return res.status(500).json({ error: 'Falla al compilar el reporte', detalle: error.message });
  }
});

// =========================================================================
// ---> RUTAS DE OPERACIÓN NORMAL <---
// =========================================================================

// Ruta principal: POST /api/telemetria
router.post('/', consumoController.registrarConsumo);

// ---> Endpoint exclusivo para los indicadores de costo <---
router.get('/metricas', consumoController.obtenerMetricasConsumo);

// ---> NUEVA RUTA RÁPIDA: Lee directamente la memoria RAM del servidor <---
router.get('/envivo/:idCircuito', consumoController.obtenerEnVivo);

// Ruta para LEER el historial de un circuito (La que usa Angular para las gráficas)
router.get('/:idCircuito', consumoController.obtenerHistorial);

module.exports = router;