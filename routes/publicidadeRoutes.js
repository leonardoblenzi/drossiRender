// routes/publicidadeRoutes.js
const express = require('express');
const router = express.Router();

const PublicidadeController = require('../controllers/PublicidadeController');

// ==========================================
// Product Ads – Campanhas, Itens, CSV, Gráfico
// Prefixo no index.js: app.use('/api/publicidade', publicidadeRoutes);
// ==========================================

// Campanhas + métricas agregadas
// GET /api/publicidade/product-ads/campaigns?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/product-ads/campaigns',
  PublicidadeController.listarCampanhas
);

// Itens (anúncios) de uma campanha específica
// GET /api/publicidade/product-ads/campaigns/:id/items?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/product-ads/campaigns/:id/items',
  PublicidadeController.listarItensCampanha
);

// Exportar itens da campanha em CSV
// GET /api/publicidade/product-ads/campaigns/:id/export?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/product-ads/campaigns/:id/export',
  PublicidadeController.exportarItensCampanha
);

// Métricas diárias (para o gráfico de linha)
// GET /api/publicidade/product-ads/metrics/daily?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/product-ads/metrics/daily',
  PublicidadeController.metricasDiarias
);

module.exports = router;
