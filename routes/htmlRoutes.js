const express = require('express');
const path = require('path'); // ← ESTA LINHA ESTAVA FALTANDO

// Tentar diferentes variações do nome
let HtmlController;
try {
  HtmlController = require('../controllers/HtmlController');
} catch (error) {
  try {
    HtmlController = require('../controllers/HtmlController');
  } catch (error2) {
    console.error('❌ Erro ao carregar HtmlController:', error2.message);
    throw error2;
  }
}

const router = express.Router();

// Resto do código...
router.get('/', HtmlController.servirDashboard);
router.get('/remover-promocao', HtmlController.servirRemoverPromocao);
router.get('/criar-dashboard', HtmlController.criarDashboard);
router.get('/criar-arquivo-remocao', HtmlController.criarArquivoRemocao);
router.get('/debug/routes', HtmlController.debugRoutes);

// Rota para criar promoções
router.get('/criar-promocao', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/criar-promocao.html'));
});

router.get('/test', (req, res) => {
  res.send('Servidor Node.js com Express está rodando!');
});

module.exports = router;