// routes/removerPromocaoRoutes.js
const express = require('express');
const router = express.Router();

// Controller antigo que você já usa nesta tela
const RemoverPromocaoController = require('../controllers/RemoverPromocaoController');

/**
 * 🔹 Remoção individual (fluxo antigo)
 * POST /anuncio/remover-promocao
 * body: { mlb_id: "MLB123..." }
 */
router.post(
  '/anuncio/remover-promocao',
  RemoverPromocaoController.removerPromocaoUnica
);

/**
 * 🔹 Remoção em lote (fluxo antigo)
 * POST /anuncios/remover-promocoes-lote
 * body: { mlb_ids: ["MLB123...", "MLB456..."], delay_entre_remocoes?: 3000 }
 */
router.post(
  '/anuncios/remover-promocoes-lote',
  RemoverPromocaoController.removerPromocoesLote
);

/**
 * 🔹 Status do processamento (fluxo antigo)
 * GET /anuncios/status-remocao/:id
 */
router.get(
  '/anuncios/status-remocao/:id',
  RemoverPromocaoController.obterStatusRemocao
);

module.exports = router;
