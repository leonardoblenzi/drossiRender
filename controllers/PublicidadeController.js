// controllers/PublicidadeController.js
const ProductAdsService = require('../services/productAdsService');

/**
 * Helper para mapear o resultado do service -> HTTP response
 */
function sendFromResult(res, result, context) {
  if (!result) {
    return res.status(500).json({
      success: false,
      error: `Retorno vazio do service em ${context}`,
    });
  }

  // Sucesso direto
  if (result.success) {
    return res.status(200).json(result);
  }

  const payload = {
    success: false,
    error: result.error || 'Erro desconhecido',
    code: result.code || null,
  };

  // Mapeamento básico por código (vindo do ProductAdsService)
  switch (result.code) {
    case 'NO_ADVERTISER':
      // Sem advertiser configurado / habilitado
      return res.status(404).json(payload);

    case 'CAMPAIGNS_ERROR':
    case 'ITEMS_ERROR':
    case 'METRICS_ERROR':
    case 'ML_NOT_FOUND':
      // Erros vindo da API do Mercado Livre (404 resource not found, etc.)
      return res.status(502).json(payload);

    default:
      // Qualquer erro de uso/parâmetro
      return res.status(400).json(payload);
  }
}

module.exports = {
  // ==========================================
  // LISTAR CAMPANHAS
  // GET /api/publicidade/product-ads/campaigns
  // ==========================================
  async listarCampanhas(req, res) {
    try {
      const { date_from, date_to } = req.query;
      const { mlCreds, accountKey } = res.locals;

      const result = await ProductAdsService.listarCampanhas(
        { date_from, date_to },
        { mlCreds, accountKey }
      );

      return sendFromResult(res, result, 'listarCampanhas');
    } catch (err) {
      console.error('Erro em listarCampanhas:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno em listarCampanhas',
      });
    }
  },

  // ==========================================
  // LISTAR ITENS DE UMA CAMPANHA
  // GET /api/publicidade/product-ads/campaigns/:id/items
  // ==========================================
  async listarItensCampanha(req, res) {
    try {
      const { id } = req.params;
      const { date_from, date_to } = req.query;
      const { mlCreds, accountKey } = res.locals;

      const result = await ProductAdsService.listarItensCampanha(
        id,
        { date_from, date_to },
        { mlCreds, accountKey }
      );

      return sendFromResult(res, result, 'listarItensCampanha');
    } catch (err) {
      console.error('Erro em listarItensCampanha:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno em listarItensCampanha',
      });
    }
  },

  // ==========================================
  // EXPORTAR ITENS DA CAMPANHA EM CSV
  // GET /api/publicidade/product-ads/campaigns/:id/export
  // ==========================================
  async exportarItensCampanha(req, res) {
    try {
      const { id } = req.params;
      const { date_from, date_to } = req.query;
      const { mlCreds, accountKey } = res.locals;

      const result = await ProductAdsService.exportarItensCampanhaCsv(
        id,
        { date_from, date_to },
        { mlCreds, accountKey }
      );

      if (!result || !result.success) {
        return sendFromResult(res, result, 'exportarItensCampanha');
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="product-ads-campanha-${id}.csv"`
      );
      return res.send(result.csv);
    } catch (err) {
      console.error('Erro em exportarItensCampanha:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno em exportarItensCampanha',
      });
    }
  },

  // ==========================================
  // MÉTRICAS DIÁRIAS (GRÁFICO)
  // GET /api/publicidade/product-ads/metrics/daily
  // ==========================================
  async metricasDiarias(req, res) {
    try {
      const { date_from, date_to } = req.query;
      const { mlCreds, accountKey } = res.locals;

      const result = await ProductAdsService.metricasDiarias(
        { date_from, date_to },
        { mlCreds, accountKey }
      );

      return sendFromResult(res, result, 'metricasDiarias');
    } catch (err) {
      console.error('Erro em metricasDiarias:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno em metricasDiarias',
      });
    }
  },
};
