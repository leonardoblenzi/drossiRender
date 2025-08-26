// routes/criarPromocaoRoutes.js
const express = require('express');
const router = express.Router();

const CriarPromocaoController = require('../controllers/CriarPromocaoController'); // << path correto

// Desconto individual (um MLB)
router.post('/desconto/unico', CriarPromocaoController.descontoUnico);

// Desconto individual em lote (vários MLBs)
router.post('/desconto/lote', CriarPromocaoController.descontoLote);

// Status e download do job
router.get('/status/:jobId', CriarPromocaoController.status);
router.get('/download/:jobId', CriarPromocaoController.download);

module.exports = router;
