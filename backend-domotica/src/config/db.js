const mongoose = require('mongoose');

const conectarDB = async () => {
    try {
        // Intentamos conectar usando la variable secreta de nuestro .env
        const connection = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Conectado: ${connection.connection.host}`);
    } catch (error) {
        console.error(`Error de conexión a MongoDB: ${error.message}`);
        process.exit(1); // Detiene el servidor si la base de datos falla, como un breaker de protección
    }
};

module.exports = conectarDB;