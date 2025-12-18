// middleware/authMiddleware.js
const TokenService = require('../services/tokenService'); // caminho ok

// Rotas/métodos que não precisam de token ML (evita refresh desnecessário)
const SKIP_PATHS = [
  /^\/api\/account\/current(?:\/|$)/i,      // info da conta atual
  /^\/api\/health(?:\/|$)/i,                // health checks
  /^\/health(?:\/|$)/i,
  /^\/api\/pesquisa-descricao\/jobs/i,      // já existia
  /^\/api\/pesquisa-descricao\/status/i,    // já existia

  // ✅ NOVO: polling e download do filtro-anuncios (não precisa token ML)
  /^\/api\/analytics\/filtro-anuncios\/jobs\/[^\/]+(?:\/|$)/i,
];

const SKIP_METHODS = new Set(['OPTIONS', 'HEAD']);

function isSkipped(req) {
  if (SKIP_METHODS.has(req.method)) return true;
  const p = req.path || req.originalUrl || '';
  return SKIP_PATHS.some((rx) => rx.test(p));
}

function ensureCredsBag(res) {
  if (!res.locals) res.locals = {};
  if (!res.locals.mlCreds) res.locals.mlCreds = {};
  return res.locals.mlCreds;
}

function getAccountMeta(res) {
  return { key: res?.locals?.accountKey || null, label: res?.locals?.accountLabel || null };
}

function attachAuthContext(req, res, accessToken) {
  // Garante estrutura mínima em res.locals
  const creds = ensureCredsBag(res);

  res.locals.accessToken = accessToken || null;
  creds.access_token = accessToken || creds.access_token || null;

  // Compat com código legado
  req.access_token = accessToken || null;

  // Atalho útil em handlers
  req.ml = {
    accessToken: accessToken || null,
    creds,
    accountKey: res?.locals?.accountKey || null,
    accountLabel: res?.locals?.accountLabel || null,
  };
}

const authMiddleware = async (req, res, next) => {
  if (isSkipped(req)) return next();

  const account = getAccountMeta(res);
  try {
    const creds = ensureCredsBag(res);
    const token = await TokenService.renovarTokenSeNecessario(creds);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token de acesso indisponível para a conta atual',
        account,
      });
    }

    attachAuthContext(req, res, token);

    // (opcional) preenche dados do user para logs/ui
    try {
      const teste = await TokenService.testarToken(res.locals.mlCreds);
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
  if (isSkipped(req)) return next();

  const account = getAccountMeta(res);
  try {
    const creds = ensureCredsBag(res);

    let token = null;
    try {
      token = await TokenService.renovarTokenSeNecessario(creds);
    } catch (e) {
      console.warn('⚠️ authMiddlewareOptional: não foi possível obter/renovar token:', e?.message || e);
    }

    attachAuthContext(req, res, token);

    if (token) {
      try {
        const teste = await TokenService.testarToken(res.locals.mlCreds);
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
