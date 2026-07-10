const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  correo: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true
  },
  password: { 
    type: String, 
    required: true 
  },
  rol: { 
    type: String, 
    enum: ['admin', 'operador'], 
    default: 'operador' 
  },
  // Aquí amarramos el usuario al hardware físico
  nodos_asignados: [{ 
    type: String // Guardaremos las MAC Address (ej. "24:0A:C4:00:01:10")
  }] 
}, { timestamps: true });

module.exports = mongoose.model('Usuario', usuarioSchema);