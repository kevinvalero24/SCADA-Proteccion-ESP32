const express = require('express');
const router = express.Router();
const alertaController = require('../controllers/alertaController');

// Endpoint GET: /api/alertas
router.get('/', alertaController.obtenerHistorialAlertas);

module.exports = router;