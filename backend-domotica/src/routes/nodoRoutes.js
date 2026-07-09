const express = require('express');
const router = express.Router();
const nodoController = require('../controllers/nodoController');

router.post('/', nodoController.crearNodo);
router.get('/', nodoController.obtenerNodos);
module.exports = router;

// ---> NUEVA LÍNEA: Ruta dinámica para ACTUALIZAR el circuito (PUT) <---
router.put('/:idNodo/circuito/:idCircuito', nodoController.actualizarEstadoCircuito);

module.exports = router;