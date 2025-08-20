// controllers/AdAnalysisController.js
const AdAnalysisService = require('../services/adAnalysisService');

function getAccountMeta(res) {
  return {
    key: res?.locals?.accountKey || null,
    label: res?.locals?.accountLabel || null
  };
}

// repassa credenciais da conta atual (ensureAccount colocou em res.locals.mlCreds)
function getCreds(res) {
  return res?.locals?.mlCreds || {};
}

class AdAnalysisController {
  static async analisarItem(req, res) {
    try {
      const { mlb } = req.body || {};
      if (!mlb) {
        return res.status(400).json({ success: false, error: 'Informe o MLB.' });
      }
      const result = await AdAnalysisService.analisarUm(String(mlb).trim(), getCreds(res));
      return res.json({ ...result, account: getAccountMeta(res) });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao analisar',
        account: getAccountMeta(res)
      });
    }
  }

  static async gerarXlsx(req, res) {
    try {
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum dado para exportar.' });
      }
      const buffer = await AdAnalysisService.gerarXlsx(rows);
      const fileName = `analise-anuncios-${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(Buffer.from(buffer));
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao gerar XLSX'
      });
    }
  }
}

module.exports = AdAnalysisController;
