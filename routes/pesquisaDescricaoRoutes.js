const express = require('express');
const router = express.Router();

console.log('🔄 Carregando pesquisaDescricaoRoutes...');

const pesquisaDescricaoController = require('../controllers/pesquisaDescricaoController');

console.log('✅ Controller importado nas routes');
console.log('📋 Tipo do controller:', typeof pesquisaDescricaoController);

router.use((req, res, next) => {
    console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('📋 Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

router.post('/pesquisar', (req, res) => {
    console.log('🚀 Rota /pesquisar chamada');
    console.log('🔍 Verificando método pesquisar...');
    console.log('📋 Tipo do método pesquisar:', typeof pesquisaDescricaoController.pesquisar);
    
    if (typeof pesquisaDescricaoController.pesquisar !== 'function') {
        console.error('❌ Método pesquisar não é uma função!');
        return res.status(500).json({
            success: false,
            message: 'Método pesquisar não encontrado'
        });
    }
    
    return pesquisaDescricaoController.pesquisar(req, res);
});

router.get('/teste', (req, res) => {
    console.log('🧪 Rota /teste chamada');
    return pesquisaDescricaoController.teste(req, res);
});

console.log('✅ pesquisaDescricaoRoutes carregado');

module.exports = router;