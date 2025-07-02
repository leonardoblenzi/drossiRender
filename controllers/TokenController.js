const TokenService = require('../services/tokenService');

class TokenController {
  static async renovarToken(req, res) {
    try {
      const resultado = await TokenService.renovarToken();
      res.json(resultado);
    } catch (error) {
      console.error('Erro ao renovar token:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async verificarToken(req, res) {
    try {
      const resultado = await TokenService.verificarToken();
      res.json(resultado);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async testarToken(req, res) {
    try {
      const resultado = await TokenService.testarToken();
      
      if (resultado.success) {
        res.json(resultado);
      } else {
        res.status(401).json(resultado);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async getAccessToken(req, res) {
    try {
      const app_id = process.env.APP_ID;
      const client_secret = process.env.CLIENT_SECRET;
      const refresh_token = process.env.REFRESH_TOKEN;

      const resultado = await TokenService.obterAccessToken(app_id, client_secret, refresh_token);
      res.json(resultado);

    } catch (error) {
      console.error('Erro ao obter token:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  static async obterTokenInicial(req, res) {
    try {
      const { 
        APP_ID: app_id,
        CLIENT_SECRET: client_secret,
        ML_CODE: code,
        REDIRECT_URI: redirect_uri
      } = process.env;

      if (!app_id || !client_secret || !code || !redirect_uri) {
        throw new Error('Credenciais não configuradas corretamente');
      }

      const resultado = await TokenService.obterTokenInicial(app_id, client_secret, code, redirect_uri);
      
      res.json({
        success: true,
        data: resultado
      });

    } catch (error) {
      console.error('Erro na requisição:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = TokenController;