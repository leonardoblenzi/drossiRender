const express = require('express');
const path = require('path');

let HtmlController;
try {
  HtmlController = require('../controllers/HtmlController');
} catch (error) {
  console.error('❌ Erro ao carregar HtmlController:', error.message);
  throw error;
}

const router = express.Router();

// (opcional) segurança extra: se alguém cair aqui via '/', manda pro dashboard
router.get('/', (req, res) => res.redirect('/dashboard'));

// Dashboard agora em /dashboard
router.get('/dashboard', HtmlController.servirDashboard);

// Demais páginas
router.get('/remover-promocao', HtmlController.servirRemoverPromocao);
router.get('/criar-dashboard', HtmlController.criarDashboard);
router.get('/criar-arquivo-remocao', HtmlController.criarArquivoRemocao);
router.get('/debug/routes', HtmlController.debugRoutes);

// Página estática da interface de criar promoções
router.get('/criar-promocao', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/criar-promocao.html'));
});

router.get('/test', (req, res) => {
  res.send('Servidor Node.js com Express está rodando!');
});

module.exports = router;
