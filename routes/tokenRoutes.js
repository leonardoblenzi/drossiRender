const express = require('express');
const TokenController = require('../controllers/TokenController');

const router = express.Router();

// Rotas de token
router.post('/getAccessToken', TokenController.getAccessToken);
router.post('/renovar-token-automatico', TokenController.renovarToken);
router.get('/verificar-token', TokenController.verificarToken);
router.get('/test-token', TokenController.testarToken);

// Rota para autenticação inicial
router.post('/dados', TokenController.obterTokenInicial);

module.exports = router;