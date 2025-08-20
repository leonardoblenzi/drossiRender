// routes/adAnalysisRoutes.js
const express = require('express');
const AdAnalysisController = require('../controllers/AdAnalysisController');

const router = express.Router();

// POST /api/analise-anuncios/analisar-item  { mlb }
router.post('/analisar-item', AdAnalysisController.analisarItem);

// POST /api/analise-anuncios/gerar-xlsx  { rows: [...] }
router.post('/gerar-xlsx', AdAnalysisController.gerarXlsx);

module.exports = router;
