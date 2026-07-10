const express = require('express');
const router = express.Router();
const nodoController = require('../controllers/nodoController');

// Importamos el middleware que valida el token JWT
const verificarJWT = require('../middlewares/authMiddleware');

// =========================================================================
// INTERRUPTOR DE SEGURIDAD INDUSTRIAL: MIDDLEWARE DE VERIFICACIÓN DE ROL
// =========================================================================
const permitirIngenierosYAdmins = (req, res, next) => { // <-- ¡Corregido, sin espacios!
    // 1. Verificamos que el middleware anterior ya haya validado el JWT con éxito
    if (!req.usuario) {
        return res.status(401).json({ mensaje: 'Sesión inválida, autenticación requerida.' });
    }

    // 2. Extraemos el rol guardado dentro del payload del Token JWT
    const rolUsuario = req.usuario.role || req.usuario.rol; 

    // 3. Aplicamos la regla estricta: Si es operador, se le corta el paso
    if (rolUsuario === 'operador') {
        console.log(`[ALERT SCADA] Intento de intrusión bloqueado: Usuario con rol OPERADOR intentó modificar parámetros de hardware.`);
        return res.status(403).json({ 
            mensaje: 'Acceso denegado: Su nivel de usuario (Operador) no tiene privilegios para alterar la configuración de campo.' 
        });
    }

    // Si es Administrador o Ingeniero, se le da luz verde para pasar al controlador
    next();
};

// =========================================================================
// ENDPOINTS DE OPERACIÓN COLECTIVA
// =========================================================================
router.post('/', nodoController.crearNodo);
router.get('/', nodoController.obtenerNodos);

// ---> RUTA BLINDADA: Valida el JWT primero, luego el Rol, y finalmente ejecuta el cambio <---
router.put('/:idNodo/circuito/:idCircuito', verificarJWT, permitirIngenierosYAdmins, nodoController.actualizarEstadoCircuito);

module.exports = router;