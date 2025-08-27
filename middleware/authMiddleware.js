// middleware/authMiddleware.js
const TokenService = require('../services/tokenService'); // << caminho corrigido

const SKIP = [
  /^\/api\/pesquisa-descricao\/jobs/i,
  /^\/api\/pesquisa-descricao\/status/i,
];

function isSkipped(pathname = '') {
  return SKIP.some((rx) => rx.test(pathname));
}

function getAccountMeta(res) {
  return { key: res?.locals?.accountKey || null, label: res?.locals?.accountLabel || null };
}

function getCreds(res) {
  return res?.locals?.mlCreds || {};
}

function attachAuthContext(req, res, accessToken) {
  res.locals.accessToken = accessToken || null;
  req.access_token = accessToken || null;
  req.ml = {
    accessToken: accessToken || null,
    creds: getCreds(res),
    accountKey: res?.locals?.accountKey || null,
    accountLabel: res?.locals?.accountLabel || null,
  };
}

const authMiddleware = async (req, res, next) => {
  if (isSkipped(req.path)) return next();

  const account = getAccountMeta(res);
  try {
    const token = await TokenService.renovarTokenSeNecessario(getCreds(res));
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token de acesso indisponível para a conta atual',
        account,
      });
    }

    attachAuthContext(req, res, token);

    // mantém o token fresco em mlCreds
    res.locals.mlCreds = res.locals.mlCreds || {};
    res.locals.mlCreds.access_token = token;

    try {
      const teste = await TokenService.testarToken(getCreds(res));
      if (teste?.success) {
        req.user_data = { user_id: teste.user_id, nickname: teste.nickname };
      }
    } catch (e) {
      console.warn('⚠️ authMiddleware: falha ao testar token:', e?.message || e);
    }

    return next();
  } catch (error) {
    console.error('❌ authMiddleware:', error?.message || error);
    return res.status(401).json({
      success: false,
      error: 'Token inválido e não foi possível renovar: ' + (error?.message || 'Erro desconhecido'),
      account,
    });
  }
};

const authMiddlewareOptional = async (req, res, next) => {
  if (isSkipped(req.path)) return next();

  const account = getAccountMeta(res);
  try {
    let token = null;
    try {
      token = await TokenService.renovarTokenSeNecessario(getCreds(res));
    } catch (e) {
      console.warn('⚠️ authMiddlewareOptional: não foi possível obter/renovar token:', e?.message || e);
    }

    attachAuthContext(req, res, token);

    if (token) {
      res.locals.mlCreds = res.locals.mlCreds || {};
      res.locals.mlCreds.access_token = token;
    }

    if (token) {
      try {
        const teste = await TokenService.testarToken(getCreds(res));
        if (teste?.success) {
          req.user_data = { user_id: teste.user_id, nickname: teste.nickname };
        }
      } catch (e) {
        console.warn('⚠️ authMiddlewareOptional: falha ao testar token:', e?.message || e);
      }
    }

    return next();
  } catch (error) {
    console.warn('⚠️ authMiddlewareOptional:', error?.message || error);
    return next();
  }
};

module.exports = { authMiddleware, authMiddlewareOptional };
