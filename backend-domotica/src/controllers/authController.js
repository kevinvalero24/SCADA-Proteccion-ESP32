const Usuario = require('../models/Usuario');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// =========================================================================
// 1. REGISTRO DE USUARIOS (El que tenías en las rutas)
// =========================================================================
exports.registrarUsuario = async (req, res) => {
    try {
        const { correo, password, rol, nodos_asignados } = req.body;

        // Verificamos que el correo no esté repetido
        const usuarioExistente = await Usuario.findOne({ correo: correo.toLowerCase().trim() });
        if (usuarioExistente) {
            return res.status(400).json({ error: 'El correo ya está en uso en otro tablero' });
        }

        // Encriptación nivel industrial (Hashing)
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);

        // Guardamos en MongoDB
        const nuevoUsuario = new Usuario({
            correo,
            password: passwordEncriptada,
            rol: rol || 'operador', // asume operador por seguridad
            nodos_asignados: nodos_asignados || []
        });

        await nuevoUsuario.save();
        res.status(201).json({ mensaje: `Usuario con rol '${nuevoUsuario.rol}' creado exitosamente` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Falla interna al registrar el usuario' });
    }
};

// =========================================================================
// 2. INICIO DE SESIÓN (LOGIN)
// =========================================================================
exports.login = async (req, res) => {
    try {
        const { correo, password } = req.body;

        // 1. Buscamos al usuario
        const usuario = await Usuario.findOne({ correo: correo.toLowerCase().trim() });
        if (!usuario) {
            return res.status(404).json({ error: 'Credenciales inválidas' });
        }

        // 2. Comparamos las contraseñas
        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // 3. Generamos el Token JWT (La llave de acceso)
        // Asegúrate de tener un JWT_SECRET en tu archivo .env
        const token = jwt.sign(
            { id: usuario._id, rol: usuario.rol, correo: usuario.correo },
            process.env.JWT_SECRET || 'llave_scada_secreta', 
            { expiresIn: '8h' }
        );

        res.status(200).json({ token, rol: usuario.rol, correo: usuario.correo });
    } catch (error) {
        res.status(500).json({ error: 'Falla al procesar el inicio de sesión' });
    }
};