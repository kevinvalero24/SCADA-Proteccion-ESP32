const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ---> ENDPOINTS DE SEGURIDAD <---

// Ruta para inyectar nuevos usuarios (POST)
router.post('/registro', authController.registrarUsuario);

// Ruta para que el HMI inicie sesión (POST)
router.post('/login', authController.login);

module.exports = router;