// services/tokenService.js
const fetch = require('node-fetch');
const config = require('../config/config');

/** Unifica leitura de credenciais (+ account_key para prefixo de logs) */
function resolveCreds(input = {}) {
  const creds = {
    app_id:
      input.app_id ||
      input.APP_ID ||
      input.client_id ||
      input.ML_APP_ID ||
      process.env.APP_ID ||
      process.env.ML_APP_ID ||
      process.env.MERCADOLIBRE_APP_ID,
    client_secret:
      input.client_secret ||
      input.CLIENT_SECRET ||
      input.ML_CLIENT_SECRET ||
      process.env.CLIENT_SECRET ||
      process.env.ML_CLIENT_SECRET ||
      process.env.MERCADOLIBRE_CLIENT_SECRET,
    refresh_token:
      input.refresh_token ||
      input.REFRESH_TOKEN ||
      input.ML_REFRESH_TOKEN ||
      process.env.REFRESH_TOKEN ||
      process.env.ML_REFRESH_TOKEN ||
      process.env.MERCADOLIBRE_REFRESH_TOKEN,
    access_token:
      input.access_token ||
      input.ACCESS_TOKEN ||
      process.env.ACCESS_TOKEN ||
      process.env.MERCADOLIBRE_ACCESS_TOKEN,
    redirect_uri:
      input.redirect_uri ||
      input.REDIRECT_URI ||
      input.ML_REDIRECT_URI ||
      process.env.REDIRECT_URI ||
      process.env.ML_REDIRECT_URI,

    // 🔑 chave da conta para prefixo dos logs
    account_key:
      input.account_key ||
      input.accountKey ||
      process.env.ACCOUNT_KEY ||
      process.env.SELECTED_ACCOUNT ||
      null,
  };
  return creds;
}

/** Lê payload de erro com segurança */
async function safeErrorPayload(resp) {
  try { return await resp.json(); } catch {}
  try { return await resp.text(); } catch {}
  return null;
}

/** Prefixo bonito para logs: [rossidecor] / [diplany] / [drossi] / [sem-conta] */
function logPrefix(credsInput = {}) {
  const { account_key } = resolveCreds(credsInput);
  return `[${account_key || 'sem-conta'}]`;
}

class TokenService {
  /**
   * Usa ACCESS_TOKEN atual; se falhar, renova via refresh_token.
   * @param {object} [credsInput]
   * @returns {Promise<string>} access_token válido
   */
  static async renovarTokenSeNecessario(credsInput = {}) {
    const L = logPrefix(credsInput);
    try {
      const { access_token } = resolveCreds(credsInput);

      if (access_token) {
        const testResponse = await fetch(config.urls.users_me, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        if (testResponse.ok) {
          console.log(`✅ ${L} Token atual válido`);
          return access_token;
        }
        console.log(`🔄 ${L} Token inválido/expirado, tentando renovar…`);
      } else {
        console.log(`ℹ️ ${L} ACCESS_TOKEN ausente; tentando renovar…`);
      }

      const novo = await this.renovarToken(credsInput);
      return novo.access_token;
    } catch (error) {
      console.error(`❌ ${L} Erro ao renovar token (automático):`, error.message);
      throw error;
    }
  }

  /**
   * Renova o token usando refresh_token e valida em /users/me.
   * @param {object} [credsInput]
   */
  static async renovarToken(credsInput = {}) {
    const L = logPrefix(credsInput);
    try {
      const { app_id, client_secret, refresh_token, redirect_uri } =
        resolveCreds(credsInput);

      if (!app_id || !client_secret || !refresh_token) {
        throw new Error(`${L} Credenciais não configuradas (APP_ID/CLIENT_SECRET/REFRESH_TOKEN). Selecione a conta correta em /select-conta.`);
      }

      console.log(`🔄 ${L} Renovando token…`);

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: String(app_id),
        client_secret: String(client_secret),
        refresh_token: String(refresh_token)
      });
      if (redirect_uri) body.append('redirect_uri', String(redirect_uri));

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorData = await safeErrorPayload(response);
        const msg =
          (errorData && (errorData.error || errorData.message)) ||
          `HTTP ${response.status}`;
        throw new Error(`${L} Erro na API ao renovar token: ${msg}`);
      }

      const data = await response.json();

      // Atualiza env para compatibilidade
      process.env.ACCESS_TOKEN = data.access_token;

      console.log(`✅ ${L} Token renovado e atualizado! (${data.access_token ? data.access_token.substring(0, 18) + '…' : ''})`);

      // Valida o novo token
      const testResponse = await fetch(config.urls.users_me, {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      if (!testResponse.ok) {
        const payload = await safeErrorPayload(testResponse);
        throw new Error(`${L} Token renovado mas falhou em /users/me: ${
          (payload && (payload.error || payload.message)) || `HTTP ${testResponse.status}`
        }`);
      }

      const userData = await testResponse.json();
      return {
        success: true,
        message: 'Token renovado e testado com sucesso!',
        access_token: data.access_token,
        expires_in: data.expires_in,
        user_id: userData.id,
        nickname: userData.nickname,
        refresh_token: data.refresh_token || refresh_token
      };
    } catch (error) {
      console.error(`❌ ${L} Erro ao renovar token:`, error.message || error);
      throw error;
    }
  }

  /**
   * Verifica o token atual; se inválido/ausente, renova automaticamente.
   * @param {object} [credsInput]
   */
  static async verificarToken(credsInput = {}) {
    const L = logPrefix(credsInput);
    try {
      const { access_token } = resolveCreds(credsInput);

      if (!access_token) {
        console.log(`ℹ️ ${L} ACCESS_TOKEN ausente; tentando renovar…`);
        const renovarResult = await this.renovarToken(credsInput);
        return {
          success: true,
          message: 'ACCESS_TOKEN estava ausente — foi renovado automaticamente e validado.',
          ...renovarResult
        };
      }

      const testResponse = await fetch(config.urls.users_me, {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      if (testResponse.ok) {
        const userData = await testResponse.json();
        return {
          success: true,
          message: 'Token válido',
          user_id: userData.id,
          nickname: userData.nickname,
          token_preview:
            access_token.substring(0, 20) +
            (access_token.length > 20 ? '…' : '')
        };
      }

      console.log(`🔄 ${L} Token inválido, tentando renovar…`);
      const renovarResult = await this.renovarToken(credsInput);
      return {
        success: true,
        message: 'Token era inválido mas foi renovado automaticamente',
        ...renovarResult
      };
    } catch (error) {
      throw error;
    }
  }

  /** Apenas testa o ACCESS_TOKEN atual. */
  static async testarToken(credsInput = {}) {
    const L = logPrefix(credsInput);
    try {
      const { access_token } = resolveCreds(credsInput);
      if (!access_token) {
        throw new Error(`${L} ACCESS_TOKEN não configurado (selecione a conta).`);
      }

      const headers = {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const response = await fetch(config.urls.users_me, { headers });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          user_id: data.id,
          nickname: data.nickname,
          message: 'Token funcionando perfeitamente!'
        };
      } else {
        const errorData = await safeErrorPayload(response);
        return {
          success: false,
          error: errorData,
          message: 'Token com problema'
        };
      }
    } catch (error) {
      throw error;
    }
  }

  /** Renova token recebendo explicitamente as credenciais. */
  static async obterAccessToken(app_idOrObj, client_secret, refresh_token) {
    try {
      let app_id = app_idOrObj;
      let redirect_uri;
      let account_key;

      if (typeof app_idOrObj === 'object' && app_idOrObj !== null) {
        const r = resolveCreds(app_idOrObj);
        app_id = r.app_id;
        client_secret = r.client_secret;
        refresh_token = r.refresh_token;
        redirect_uri = r.redirect_uri;
        account_key = r.account_key;
      }
      const L = `[${account_key || process.env.ACCOUNT_KEY || 'sem-conta'}]`;

      if (!app_id || !client_secret || !refresh_token) {
        throw new Error(`${L} Parâmetros insuficientes para obterAccessToken (app_id, client_secret, refresh_token).`);
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: String(app_id),
        client_secret: String(client_secret),
        refresh_token: String(refresh_token)
      });
      if (redirect_uri) body.append('redirect_uri', String(redirect_uri));

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorData = await safeErrorPayload(response);
        const msg =
          (errorData && (errorData.error || errorData.message)) ||
          `HTTP ${response.status}`;
        throw new Error(`${L} Erro na API: ${msg}`);
      }

      const data = await response.json();
      console.log(`${L} Token renovado com sucesso:`, {
        access_token: data.access_token ? `${data.access_token.substring(0, 12)}…` : '(vazio)',
        expires_in: data.expires_in,
        refresh_token: data.refresh_token ? `${String(data.refresh_token).substring(0, 10)}…` : '(mantido)'
      });

      return {
        success: true,
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token || refresh_token
      };
    } catch (error) {
      throw error;
    }
  }

  /** Troca o "code" inicial por tokens. */
  static async obterTokenInicial(app_idOrObj, client_secret, code, redirect_uri) {
    try {
      let app_id = app_idOrObj;
      let account_key;
      if (typeof app_idOrObj === 'object' && app_idOrObj !== null) {
        const r = resolveCreds(app_idOrObj);
        app_id = r.app_id;
        client_secret = r.client_secret ?? client_secret;
        code = r.code ?? r.CODE ?? code;
        redirect_uri = r.redirect_uri ?? redirect_uri;
        account_key = r.account_key;
      }
      const L = `[${account_key || process.env.ACCOUNT_KEY || 'sem-conta'}]`;

      const dados = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: String(app_id),
        client_secret: String(client_secret),
        code: String(code),
        redirect_uri: String(redirect_uri)
      });

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: dados.toString()
      });

      if (!response.ok) {
        const errorData = await safeErrorPayload(response);
        const msg =
          (errorData && (errorData.message || errorData.error)) ||
          `HTTP ${response.status}`;
        throw new Error(`${L} Erro na API: ${msg}`);
      }

      const data = await response.json();
      console.log(`${L} Resposta da API (token inicial):`, {
        user_id: data.user_id,
        access_token_preview: data.access_token ? `${data.access_token.substring(0, 12)}…` : '(vazio)'
      });

      return data;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = TokenService;
