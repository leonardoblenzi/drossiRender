// controllers/TokenController.js
const TokenService = require('../services/tokenService');

/**
 * Extrai metadados da conta atual do res.locals (definidos pelo ensureAccount).
 * Mantém tudo opcional para compatibilidade quando não houver multi-conta.
 */
function getAccountMeta(res) {
  return {
    key: res?.locals?.accountKey || null,
    label: res?.locals?.accountLabel || null
  };
}

/**
 * Extrai credenciais (mlCreds) do middleware ensureAccount, se houver.
 * Se não houver, o TokenService fará fallback para process.env.
 */
function getCreds(res) {
  return res?.locals?.mlCreds || {};
}

class TokenController {
  static async renovarToken(req, res) {
    try {
      const resultado = await TokenService.renovarToken(getCreds(res));
      return res.json({
        ...resultado,
        account: getAccountMeta(res)
      });
    } catch (error) {
      console.error('Erro ao renovar token:', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao renovar token',
        account: getAccountMeta(res)
      });
    }
  }

  static async verificarToken(req, res) {
    try {
      const resultado = await TokenService.verificarToken(getCreds(res));
      return res.json({
        ...resultado,
        account: getAccountMeta(res)
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao verificar token',
        account: getAccountMeta(res)
      });
    }
  }

  static async testarToken(req, res) {
    try {
      const resultado = await TokenService.testarToken(getCreds(res));
      if (resultado.success) {
        return res.json({
          ...resultado,
          account: getAccountMeta(res)
        });
      }
      return res.status(401).json({
        ...resultado,
        account: getAccountMeta(res)
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao testar token',
        account: getAccountMeta(res)
      });
    }
  }

  /**
   * Endpoint utilitário para renovar via refresh_token explicitamente.
   * Aceita credenciais no body (opcional) e/ou usa as da conta selecionada.
   * {
   *   app_id, client_secret, refresh_token, redirect_uri
   * }
   */
  static async getAccessToken(req, res) {
    try {
      // Prioriza credenciais do body; completa com as do ensureAccount (se existirem)
      const bodyCreds = req.body || {};
      const mergedCreds = { ...getCreds(res), ...bodyCreds };

      const resultado = await TokenService.obterAccessToken(mergedCreds);
      return res.json({
        ...resultado,
        account: getAccountMeta(res)
      });
    } catch (error) {
      console.error('Erro ao obter token:', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao obter token',
        account: getAccountMeta(res)
      });
    }
  }

  /**
   * Troca o "code" inicial por tokens.
   * Aceita credenciais no body (opcional) e/ou usa as da conta selecionada/.env.
   * Body esperado (qualquer combinação; os ausentes serão preenchidos por ensureAccount/.env):
   * { app_id, client_secret, code, redirect_uri }
   */
  static async obterTokenInicial(req, res) {
    try {
      const bodyCreds = req.body || {};
      const mergedCreds = { ...getCreds(res), ...bodyCreds };

      // Se não veio nada no body e não há ensureAccount, mantém compat com .env:
      // (o TokenService.resolveCreds fará o fallback automaticamente)
      const resultado = await TokenService.obterTokenInicial(mergedCreds);

      return res.json({
        success: true,
        data: resultado,
        account: getAccountMeta(res)
      });
    } catch (error) {
      console.error('Erro na requisição (obterTokenInicial):', error?.message || error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Erro ao obter token inicial',
        account: getAccountMeta(res)
      });
    }
  }
}

module.exports = TokenController;
