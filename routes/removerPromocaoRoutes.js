const express = require('express');
const PromocaoController = require('../controllers/PromocaoController');

const router = express.Router();

// Rotas de promoção
router.post('/anuncio/remover-promocao', PromocaoController.removerPromocaoUnica);
router.post('/anuncios/remover-promocoes-lote', PromocaoController.removerPromocoesLote);
router.get('/anuncios/status-remocao/:id', PromocaoController.obterStatusRemocao);

module.exports = router;