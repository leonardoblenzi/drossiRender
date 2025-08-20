// routes/htmlRoutes.js
const express = require('express');

let HtmlController;
try {
  HtmlController = require('../controllers/HtmlController');
} catch (error) {
  console.error('❌ Erro ao carregar HtmlController:', error.message);
  throw error;
}

const router = express.Router();

/**
 * Não tratamos "/" aqui — o index.js já decide entre
 * redirecionar para /select-conta ou seguir para o dashboard.
 * Se quiser um fallback local, descomente:
 *
 * router.get('/', (req, res) => res.redirect('/dashboard'));
 */

// Dashboard
router.get('/dashboard', HtmlController.servirDashboard);

// Páginas
router.get('/remover-promocao', HtmlController.servirRemoverPromocao);
router.get('/analise-anuncios', HtmlController.servirAnaliseAnuncios);
router.get('/criar-promocao', HtmlController.criarPromocao);
router.get('/analise-anuncios', HtmlController.servirAnaliseAnuncios);

// Utilitários de geração/diagnóstico
router.get('/criar-dashboard', HtmlController.criarDashboard);
router.get('/criar-arquivo-remocao', HtmlController.criarArquivoRemocao);
router.get('/debug/routes', HtmlController.debugRoutes);

// Teste simples
router.get('/test', (req, res) => {
  res.send('Servidor Node.js com Express está rodando!');
});

module.exports = router;
