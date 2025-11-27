// controllers/ValidarDimensoesController.js
const ValidarDimensoesService = require('../services/validarDimensoesService');

function getAccountMeta(res) {
  return {
    key: res?.locals?.accountKey || null,
    label: res?.locals?.accountLabel || null,
  };
}

function getCreds(res) {
  return res?.locals?.mlCreds || {};
}

class ValidarDimensoesController {
  static async analisarItem(req, res) {
    try {
      const { mlb } = req.body || {};
      if (!mlb) {
        return res
          .status(400)
          .json({ success: false, error: 'Informe o MLB.', account: getAccountMeta(res) });
      }

      const opts = {
        mlCreds: getCreds(res),
        accountKey: res?.locals?.accountKey || 'conta',
      };

      const result = await ValidarDimensoesService.analisarUm(String(mlb).trim(), opts);

      return res.json({
        success: true,
        data: result,
        account: getAccountMeta(res),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao validar dimensões',
        account: getAccountMeta(res),
      });
    }
  }

  // Se algum dia quiser exportar do backend, podemos fazer algo como o gerarXlsx do AdAnalysis aqui.
}

module.exports = ValidarDimensoesController;
