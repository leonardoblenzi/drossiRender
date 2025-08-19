// services/tokenService.js
const fetch = require('node-fetch');
const config = require('../config/config');

/** ====== Utils ====== */
const trim = (v) => (typeof v === 'string' ? v.trim() : v);
const preview = (v, n = 12) => (v ? `${String(v).substring(0, n)}…` : '(vazio)');

function envByAccount(keyLower) {
  if (!keyLower) return {};
  const U = String(keyLower).toUpperCase();
  return {
    app_id: trim(process.env[`ML_${U}_APP_ID`]),
    client_secret: trim(process.env[`ML_${U}_CLIENT_SECRET`]),
    refresh_token: trim(process.env[`ML_${U}_REFRESH_TOKEN`]),
    access_token: trim(process.env[`ML_${U}_ACCESS_TOKEN`]),
    redirect_uri: trim(process.env[`ML_${U}_REDIRECT_URI`]),
  };
}

function resolveAccountKey(input = {}) {
  return (
    (input.accountKey && String(input.accountKey).toLowerCase()) ||
    (process.env.SELECTED_ACCOUNT && process.env.SELECTED_ACCOUNT.toLowerCase()) ||
    (process.env.ACTIVE_ACCOUNT && process.env.ACTIVE_ACCOUNT.toLowerCase()) ||
    (process.env.DEFAULT_ACCOUNT && process.env.DEFAULT_ACCOUNT.toLowerCase()) ||
    null
  );
}

/**
 * Une credenciais: prioridade é input -> env por conta -> env genérico.
 * Também injeta accountKey resolvido.
 */
function resolveCreds(input = {}) {
  const accountKey = resolveAccountKey(input);

  const fromAccountEnv = accountKey ? envByAccount(accountKey) : {};
  const genericEnv = {
    app_id: trim(process.env.APP_ID) || trim(process.env.ML_APP_ID) || trim(process.env.MERCADOLIBRE_APP_ID),
    client_secret:
      trim(process.env.CLIENT_SECRET) || trim(process.env.ML_CLIENT_SECRET) || trim(process.env.MERCADOLIBRE_CLIENT_SECRET),
    refresh_token:
      trim(process.env.REFRESH_TOKEN) || trim(process.env.ML_REFRESH_TOKEN) || trim(process.env.MERCADOLIBRE_REFRESH_TOKEN),
    access_token: trim(process.env.ACCESS_TOKEN) || trim(process.env.MERCADOLIBRE_ACCESS_TOKEN),
    redirect_uri: trim(process.env.REDIRECT_URI) || trim(process.env.ML_REDIRECT_URI),
  };

  const merged = {
    accountKey,
    app_id:
      trim(input.app_id || input.APP_ID || input.client_id || input.ML_APP_ID) ||
      fromAccountEnv.app_id ||
      genericEnv.app_id,
    client_secret:
      trim(input.client_secret || input.CLIENT_SECRET || input.ML_CLIENT_SECRET) ||
      fromAccountEnv.client_secret ||
      genericEnv.client_secret,
    refresh_token:
      trim(input.refresh_token || input.REFRESH_TOKEN || input.ML_REFRESH_TOKEN) ||
      fromAccountEnv.refresh_token ||
      genericEnv.refresh_token,
    access_token:
      trim(input.access_token || input.ACCESS_TOKEN) ||
      fromAccountEnv.access_token ||
      genericEnv.access_token,
    redirect_uri:
      trim(input.redirect_uri || input.REDIRECT_URI || input.ML_REDIRECT_URI) ||
      fromAccountEnv.redirect_uri ||
      genericEnv.redirect_uri,
    code: trim(input.code || input.CODE || input.ML_CODE),
  };

  return merged;
}

async function safeErrorPayload(resp) {
  try { return await resp.json(); } catch {}
  try { return await resp.text(); } catch {}
  return null;
}

/** ====== Cache por conta ======
 * tokenCache: Map<accountKey, { access_token, refresh_token, app_id, client_secret, redirect_uri, updated_at }>
 */
const tokenCache = new Map();

function readFromCache(accountKey) {
  if (!accountKey) return null;
  return tokenCache.get(accountKey) || null;
}
function writeToCache(accountKey, data) {
  if (!accountKey) return;
  tokenCache.set(accountKey, { ...readFromCache(accountKey), ...data, updated_at: new Date().toISOString() });
}

/** ====== TokenService ====== */
class TokenService {
  /**
   * Usa access_token atual (cache/input/env). Se inválido, renova via refresh_token.
   * Retorna um access_token válido (string).
   */
  static async renovarTokenSeNecessario(credsInput = {}) {
    const c = resolveCreds(credsInput);
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    // Preferir cache
    const cached = readFromCache(c.accountKey);
    const currentToken = trim((cached && cached.access_token) || c.access_token);

    try {
      if (currentToken) {
        const test = await fetch(config.urls.users_me, { headers: { Authorization: `Bearer ${currentToken}` } });
        if (test.ok) {
          // Garantir que o cache tem esse token
          writeToCache(c.accountKey, { access_token: currentToken });
          console.log(`✅ ${label} Token atual válido`);
          return currentToken;
        }
        console.log(`🔄 ${label} Token inválido/expirado, tentando renovar…`);
      } else {
        console.log(`ℹ️ ${label} ACCESS_TOKEN ausente; tentando renovar…`);
      }

      const novo = await this.renovarToken(c);
      // salvar no cache
      writeToCache(c.accountKey, {
        access_token: novo.access_token,
        refresh_token: novo.refresh_token || c.refresh_token,
        app_id: c.app_id,
        client_secret: c.client_secret,
        redirect_uri: c.redirect_uri,
      });
      return novo.access_token;
    } catch (err) {
      console.error(`❌ ${label} Erro ao renovar token (automático):`, err.message || err);
      throw err;
    }
  }

  /**
   * Renova via refresh_token e valida em /users/me. Retorna objeto detalhado.
   */
  static async renovarToken(credsInput = {}) {
    const c = resolveCreds(credsInput);
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    if (!c.app_id || !c.client_secret || !c.refresh_token) {
      throw new Error(
        `${label} Credenciais não configuradas (APP_ID/CLIENT_SECRET/REFRESH_TOKEN). Selecione a conta correta em /select-conta.`
      );
    }

    console.log(`🔄 ${label} Renovando token…`);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: String(c.app_id),
      client_secret: String(c.client_secret),
      refresh_token: String(c.refresh_token),
    });
    if (c.redirect_uri) body.append('redirect_uri', String(c.redirect_uri));

    const resp = await fetch(config.urls.oauth_token, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errorData = await safeErrorPayload(resp);
      const msg = (errorData && (errorData.error || errorData.message)) || `HTTP ${resp.status}`;
      throw new Error(`${label} Erro na API ao renovar token: ${msg}`);
    }

    const data = await resp.json();
    console.log(`✅ ${label} Token renovado e atualizado! (${preview(data.access_token, 18)})`);

    // Valida novo token
    const test = await fetch(config.urls.users_me, { headers: { Authorization: `Bearer ${data.access_token}` } });
    if (!test.ok) {
      const payload = await safeErrorPayload(test);
      throw new Error(
        `${label} Token renovado mas falhou em /users/me: ${(payload && (payload.error || payload.message)) || `HTTP ${test.status}`}`
      );
    }
    const user = await test.json();

    // grava no cache
    writeToCache(c.accountKey, {
      access_token: data.access_token,
      refresh_token: data.refresh_token || c.refresh_token,
      app_id: c.app_id,
      client_secret: c.client_secret,
      redirect_uri: c.redirect_uri,
    });

    return {
      success: true,
      message: 'Token renovado e testado com sucesso!',
      access_token: data.access_token,
      expires_in: data.expires_in,
      user_id: user.id,
      nickname: user.nickname,
      refresh_token: data.refresh_token || c.refresh_token,
    };
  }

  /**
   * Verifica token atual; se inválido, renova automaticamente.
   */
  static async verificarToken(credsInput = {}) {
    const c = resolveCreds(credsInput);
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    // Preferir cache
    const cached = readFromCache(c.accountKey);
    const token = trim((cached && cached.access_token) || c.access_token);

    if (!token) {
      console.log(`ℹ️ ${label} ACCESS_TOKEN ausente; tentando renovar…`);
      const novo = await this.renovarToken(c);
      return { success: true, message: 'ACCESS_TOKEN estava ausente — foi renovado automaticamente e validado.', ...novo };
    }

    const test = await fetch(config.urls.users_me, { headers: { Authorization: `Bearer ${token}` } });
    if (test.ok) {
      const user = await test.json();
      // escreve no cache se ainda não havia
      writeToCache(c.accountKey, { access_token: token });
      return {
        success: true,
        message: 'Token válido',
        user_id: user.id,
        nickname: user.nickname,
        token_preview: preview(token, 20),
      };
    }

    console.log(`🔄 ${label} Token inválido, tentando renovar…`);
    const novo = await this.renovarToken(c);
    return { success: true, message: 'Token era inválido mas foi renovado automaticamente', ...novo };
  }

  /**
   * Apenas testa o ACCESS_TOKEN atual.
   */
  static async testarToken(credsInput = {}) {
    const c = resolveCreds(credsInput);
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    const cached = readFromCache(c.accountKey);
    const token = trim((cached && cached.access_token) || c.access_token);
    if (!token) throw new Error(`${label} ACCESS_TOKEN não configurado (selecione a conta).`);

    const resp = await fetch(config.urls.users_me, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (resp.ok) {
      const data = await resp.json();
      return { success: true, user_id: data.id, nickname: data.nickname, message: 'Token funcionando perfeitamente!' };
    } else {
      const err = await safeErrorPayload(resp);
      return { success: false, error: err, message: 'Token com problema' };
    }
  }

  /**
   * Renova token recebendo objeto ou parâmetros. Atualiza cache se houver accountKey.
   */
  static async obterAccessToken(app_idOrObj, client_secret, refresh_token) {
    let c = {};
    if (typeof app_idOrObj === 'object' && app_idOrObj !== null) {
      c = resolveCreds(app_idOrObj);
    } else {
      c = resolveCreds({ app_id: app_idOrObj, client_secret, refresh_token });
    }
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    if (!c.app_id || !c.client_secret || !c.refresh_token) {
      throw new Error(`${label} Parâmetros insuficientes para obterAccessToken (app_id, client_secret, refresh_token).`);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: String(c.app_id),
      client_secret: String(c.client_secret),
      refresh_token: String(c.refresh_token),
    });
    if (c.redirect_uri) body.append('redirect_uri', String(c.redirect_uri));

    const resp = await fetch(config.urls.oauth_token, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errorData = await safeErrorPayload(resp);
      const msg = (errorData && (errorData.error || errorData.message)) || `HTTP ${resp.status}`;
      throw new Error(`${label} Erro na API: ${msg}`);
    }

    const data = await resp.json();
    console.log(`${label} Token renovado com sucesso:`, {
      access_token: preview(data.access_token, 12),
      expires_in: data.expires_in,
      refresh_token: preview(data.refresh_token || c.refresh_token, 10),
    });

    writeToCache(c.accountKey, {
      access_token: data.access_token,
      refresh_token: data.refresh_token || c.refresh_token,
      app_id: c.app_id,
      client_secret: c.client_secret,
      redirect_uri: c.redirect_uri,
    });

    return {
      success: true,
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token || c.refresh_token,
    };
  }

  /**
   * Troca "code" inicial por tokens. Atualiza cache se accountKey existir.
   */
  static async obterTokenInicial(app_idOrObj, client_secret, code, redirect_uri) {
    let c = {};
    if (typeof app_idOrObj === 'object' && app_idOrObj !== null) {
      c = resolveCreds(app_idOrObj);
    } else {
      c = resolveCreds({ app_id: app_idOrObj, client_secret, code, redirect_uri });
    }
    const label = c.accountKey ? `[${c.accountKey}]` : '[sem-conta]';

    const dados = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: String(c.app_id),
      client_secret: String(c.client_secret),
      code: String(c.code),
      redirect_uri: String(c.redirect_uri),
    });

    const resp = await fetch(config.urls.oauth_token, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: dados.toString(),
    });

    if (!resp.ok) {
      const errorData = await safeErrorPayload(resp);
      const msg = (errorData && (errorData.message || errorData.error)) || `HTTP ${resp.status}`;
      throw new Error(`${label} Erro na API: ${msg}`);
    }

    const data = await resp.json();
    console.log(`${label} Resposta da API (token inicial):`, {
      user_id: data.user_id,
      access_token_preview: preview(data.access_token, 12),
    });

    writeToCache(c.accountKey, {
      access_token: data.access_token,
      refresh_token: data.refresh_token || c.refresh_token,
      app_id: c.app_id,
      client_secret: c.client_secret,
      redirect_uri: c.redirect_uri,
    });

    return data;
  }
}

module.exports = TokenService;
