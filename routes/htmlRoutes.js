// routes/htmlRoutes.js
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

// (Opcional) Evita cache das páginas HTML
function noCache(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store'
  });
  next();
}

/**
 * Não tratamos "/" aqui — o index.js já decide entre
 * redirecionar para /select-conta ou seguir para o dashboard.
 * Se quiser um fallback local, descomente:
 *
 * router.get('/', (req, res) => res.redirect('/dashboard'));
 */

// Dashboard
router.get('/dashboard', noCache, HtmlController.servirDashboard);

// Páginas existentes
router.get('/remover-promocao', noCache, HtmlController.servirRemoverPromocao);
router.get('/analise-anuncios', noCache, HtmlController.servirAnaliseAnuncios);
router.get('/criar-promocao', noCache, HtmlController.criarPromocao);

// Utilitários de geração/diagnóstico
router.get('/criar-dashboard', noCache, HtmlController.criarDashboard);
router.get('/criar-arquivo-remocao', noCache, HtmlController.criarArquivoRemocao);
router.get('/debug/routes', HtmlController.debugRoutes);

// Teste simples
router.get('/test', (_req, res) => {
  res.send('Servidor Node.js com Express está rodando!');
});

/* ================================
 * NOVO: Página Curva ABC (HTML)
 * ================================ */
router.get('/ia-analytics/curva-abc', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'ia-analytics', 'curva-abc.html'));
});

module.exports = router;
