const jwt = require('jsonwebtoken');

const verificarJWT = (req, res, next) => {
    // 1. Obtenemos el token del encabezado de la petición
    const tokenHMI = req.header('Authorization');

    // Si no trae carné (token), le bloqueamos el paso de inmediato
    if (!tokenHMI) {
        return res.status(401).json({ mensaje: 'Acceso denegado. No hay sesión activa.' });
    }

    try {
        // 2. Le quitamos la palabra "Bearer " si el frontend la manda
        const tokenPuro = tokenHMI.replace('Bearer ', '');
        
        // 3. Verificamos que el carné sea original con nuestra llave secreta
        // OJO: La llave debe ser idéntica a la que usamos en el authController
        const decodificado = jwt.verify(tokenPuro, process.env.JWT_SECRET || 'llave_scada_secreta');
        
        // 4. Si el token es válido, le pegamos los datos del usuario a la petición
        req.usuario = decodificado;
        
        // 5. Todo en orden, le damos luz verde para que pase a la ruta (next)
        next();
    } catch (error) {
        res.status(401).json({ mensaje: 'Token inválido o expirado. Inicie sesión nuevamente.' });
    }
};

module.exports = verificarJWT;