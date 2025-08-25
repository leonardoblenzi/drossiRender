// routes/criarPromocaoRoutes.js
const express = require('express');
const router = express.Router();

const CriarPromocaoController = require('../controllers/CriarPromocaoController');

// Desconto individual (um MLB)
router.post('/desconto/unico', CriarPromocaoController.descontoUnico);

// Desconto individual em lote (vários MLBs)
router.post('/desconto/lote', CriarPromocaoController.descontoLote);

// Status e Download do job
router.get('/status/:jobId', CriarPromocaoController.status);
router.get('/download/:jobId', CriarPromocaoController.download);

// (opcional) aliases para rotas antigas
router.post('/../promocao/desconto/unico', CriarPromocaoController.descontoUnico);
router.post('/../promocao/desconto/lote', CriarPromocaoController.descontoLote);

module.exports = router;
