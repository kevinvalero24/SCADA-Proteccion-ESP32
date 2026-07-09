const express = require('express');
const router = express.Router();
const consumoController = require('../controllers/consumoController');

// Ruta principal: POST /api/telemetria
router.post('/', consumoController.registrarConsumo);

// Ruta para LEER el historial de un circuito (La que usa Angular)
router.get('/:idCircuito', consumoController.obtenerHistorial);

module.exports = router;