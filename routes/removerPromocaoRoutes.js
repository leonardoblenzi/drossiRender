const express = require('express');
const RemoverPromocaoController = require('../controllers/RemoverPromocaoController');

const router = express.Router();

// Rotas de promoção
router.post('/anuncio/remover-promocao', RemoverPromocaoController.removerPromocaoUnica);
router.post('/anuncios/remover-promocoes-lote', RemoverPromocaoController.removerPromocoesLote);
router.get('/anuncios/status-remocao/:id', RemoverPromocaoController.obterStatusRemocao);

module.exports = router;