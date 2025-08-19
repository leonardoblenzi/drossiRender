// middleware/authMiddleware.js
const TokenService = require('../services/tokenService');
const SKIP = [/^\/api\/pesquisa-descricao\/jobs/, /^\/api\/pesquisa-descricao\/status/];
if (SKIP.some(rx => rx.test(req.path))) return next();


/** Helpers */
function getAccountMeta(res) {
  return {
    key: res?.locals?.accountKey || null,
    label: res?.locals?.accountLabel || null
  };
}

function getCreds(res) {
  // Credenciais injetadas pelo ensureAccount (multi-conta).
  // Se não houver, o TokenService fará fallback para process.env.
  return res?.locals?.mlCreds || {};
}

function attachAuthContext(req, res, accessToken) {
  res.locals.accessToken = accessToken || null;
  req.access_token = accessToken || null; // compatibilidade com seu código legado

  // Também expõe metadados úteis
  req.ml = {
    accessToken: accessToken || null,
    creds: getCreds(res),
    accountKey: res?.locals?.accountKey || null,
    accountLabel: res?.locals?.accountLabel || null
  };
}

/**
 * Middleware obrigatório:
 * - Garante que exista um ACCESS_TOKEN válido (renova se necessário).
 * - Bloqueia (401) se não conseguir obter/renovar.
 * - Usa credenciais da conta selecionada (ensureAccount) ou .env como fallback.
 */
const authMiddleware = async (req, res, next) => {
  const account = getAccountMeta(res);
  try {
    // Tenta usar/renovar automaticamente com base nas credenciais da conta atual
    const token = await TokenService.renovarTokenSeNecessario(getCreds(res));
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token de acesso indisponível para a conta atual',
        account
      });
    }

    attachAuthContext(req, res, token);

    // Opcional: obter dados do usuário (útil para logs/traço)
    try {
      const teste = await TokenService.testarToken(getCreds(res));
      if (teste?.success) {
        req.user_data = {
          user_id: teste.user_id,
          nickname: teste.nickname
        };
      }
    } catch (e) {
      // Não bloqueia; já temos um token válido (testarToken é apenas informativo)
      console.warn('⚠️ Não foi possível obter dados do usuário após renovar/testar token:', e?.message || e);
    }

    return next();
  } catch (error) {
    console.error('❌ Erro no authMiddleware (obrigatório):', error?.message || error);
    return res.status(401).json({
      success: false,
      error: 'Token inválido e não foi possível renovar: ' + (error?.message || 'Erro desconhecido'),
      account
    });
  }
};

/**
 * Middleware opcional:
 * - Tenta obter/renovar token; se falhar, apenas segue sem bloquear.
 * - Anexa token e metadados no req/res quando disponível.
 */
const authMiddlewareOptional = async (req, res, next) => {
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
      try {
        const teste = await TokenService.testarToken(getCreds(res));
        if (teste?.success) {
          req.user_data = {
            user_id: teste.user_id,
            nickname: teste.nickname
          };
        }
      } catch (e) {
        // Não bloqueia, apenas loga
        console.warn('⚠️ authMiddlewareOptional: falha ao testar token:', e?.message || e);
      }
    }

    return next();
  } catch (error) {
    console.warn('⚠️ Erro inesperado no authMiddlewareOptional:', error?.message || error);
    // Segue adiante mesmo com erro
    return next();
  }
};

module.exports = {
  authMiddleware,
  authMiddlewareOptional
};
