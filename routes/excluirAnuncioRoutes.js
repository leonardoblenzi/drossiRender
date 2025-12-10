// routes/excluirAnuncioRoutes.js
const express = require('express');
const router = express.Router();

const ExcluirAnuncioController = require('../controllers/ExcluirAnuncioController');

// 🔹 Excluir um único anúncio (DELETE /anuncios/excluir/:mlb_id)
router.delete('/anuncios/excluir/:mlb_id', ExcluirAnuncioController.excluirUnico);

// 🔹 Exclusão em lote (POST /anuncios/excluir-lote)
router.post('/anuncios/excluir-lote', ExcluirAnuncioController.excluirLote);

// 🔹 Status da exclusão em lote (GET /anuncios/status-exclusao/:id)
router.get('/anuncios/status-exclusao/:id', ExcluirAnuncioController.status);

module.exports = router;
