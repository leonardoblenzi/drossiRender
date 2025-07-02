const TokenService = require('../services/tokenService');

const authMiddleware = async (req, res, next) => {
  try {
    const access_token = process.env.ACCESS_TOKEN;
    
    if (!access_token) {
      return res.status(401).json({
        success: false,
        error: 'Token de acesso não configurado'
      });
    }

    // Verificar se o token é válido
    try {
      const tokenValido = await TokenService.testarToken();
      
      if (tokenValido.success) {
        req.access_token = access_token;
        req.user_data = {
          user_id: tokenValido.user_id,
          nickname: tokenValido.nickname
        };
        next();
      } else {
        // Tentar renovar automaticamente
        console.log('🔄 Token inválido, tentando renovar automaticamente...');
        const novoToken = await TokenService.renovarTokenSeNecessario();
        req.access_token = novoToken;
        next();
      }
    } catch (error) {
      // Se falhar, tentar renovar
      try {
        const novoToken = await TokenService.renovarTokenSeNecessario();
        req.access_token = novoToken;
        next();
      } catch (renewError) {
        return res.status(401).json({
          success: false,
          error: 'Token inválido e não foi possível renovar: ' + renewError.message
        });
      }
    }

  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Erro de autenticação: ' + error.message
    });
  }
};

// Middleware opcional (não bloqueia se token não existir)
const authMiddlewareOptional = async (req, res, next) => {
  try {
    const access_token = process.env.ACCESS_TOKEN;
    
    if (access_token) {
      const tokenValido = await TokenService.testarToken();
      
      if (tokenValido.success) {
        req.access_token = access_token;
        req.user_data = {
          user_id: tokenValido.user_id,
          nickname: tokenValido.nickname
        };
      }
    }
    
    next();
  } catch (error) {
    // Em caso de erro, continua sem autenticação
    console.log('⚠️ Erro no middleware opcional:', error.message);
    next();
  }
};

module.exports = {
  authMiddleware,
  authMiddlewareOptional
};