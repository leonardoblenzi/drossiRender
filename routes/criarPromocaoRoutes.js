// routes/criarPromocaoRoutes.js
const express = require('express');
const router = express.Router();

const CriarPromocaoController = require('../controllers/CriarPromocaoController');

// Desconto individual (um MLB)
router.post('/desconto/unico', CriarPromocaoController.descontoUnico);

// Desconto individual em lote (vários MLBs)
router.post('/desconto/lote', CriarPromocaoController.descontoLote);

// Status e download do job
router.get('/status/:jobId', CriarPromocaoController.status);
router.get('/download/:jobId', CriarPromocaoController.download);

// 🛑 ROTAS DE EMERGÊNCIA PARA LIMPAR JOBS
router.post('/clear-jobs', (req, res) => {
  try {
    const result = CriarPromocaoController.clearAllJobs();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/debug-jobs', (req, res) => {
  try {
    const jobs = CriarPromocaoController.debugJobs();
    res.json({ jobs });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;