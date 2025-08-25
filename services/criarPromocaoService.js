// services/criarPromocaoService.js
const fetch = require('node-fetch');
const config = require('../config/config');
const TokenService = require('./tokenService');

function urls() {
  return {
    users_me:      config?.urls?.users_me || 'https://api.mercadolibre.com/users/me',
    items:         config?.urls?.items    || 'https://api.mercadolibre.com/items',
    sellerPromos:  config?.urls?.seller_promotions || 'https://api.mercadolibre.com/seller-promotions',
  };
}

function resolveCreds(opts = {}) {
  return {
    ...opts.mlCreds,
    accountKey: opts.accountKey || 'sem-conta',
  };
}

// fetch que injeta Authorization com renovação on-401
async function withAuth(url, init, state) {
  const call = async (token) => {
    const headers = { ...(init?.headers||{}), Authorization: `Bearer ${token}` };
    return fetch(url, { ...init, headers });
  };

  // primeira chamada
  let resp = await call(state.token);
  if (resp.status !== 401) return resp;

  // 401 → renovar token e repetir
  const novo = await TokenService.renovarToken(state.creds);
  state.token = novo.access_token;
  return call(state.token);
}

async function prepararAuth(opts = {}) {
  const creds = resolveCreds(opts);
  // tenta validar/renovar um token para essa conta
  const token = await TokenService.renovarTokenSeNecessario(creds);
  return { token, creds, key: creds.accountKey || 'sem-conta' };
}

function arred2(n) { return Math.round(Number(n) * 100) / 100; }

class CriarPromocaoService {
  /**
   * Aplica desconto de preço (PRICE_DISCOUNT) em um único item.
   * Tenta as formas conhecidas de payload; se não aceitar, devolve o erro da API.
   */
  static async aplicarDescontoUnico(mlbId, percent, options = {}) {
    const state = await prepararAuth(options);
    const U = urls();
    const baseHeaders = { 'content-type': 'application/json' };

    // 1) dados do item
    const rItem = await withAuth(`${U.items}/${mlbId}`, { method:'GET' }, state);
    if (!rItem.ok) {
      const tx = await rItem.text().catch(()=>'');
      return { success:false, mlb_id: mlbId, error: `Falha ao obter item: HTTP ${rItem.status} ${tx}` };
    }
    const item = await rItem.json();

    // 2) valida dono
    const rMe = await withAuth(U.users_me, { method:'GET' }, state);
    if (!rMe.ok) {
      const tx = await rMe.text().catch(()=>'');
      return { success:false, mlb_id: mlbId, error: `Falha users/me: HTTP ${rMe.status} ${tx}` };
    }
    const me = await rMe.json();
    if (item.seller_id !== me.id) {
      return { success:false, mlb_id: mlbId, error: 'Anúncio não pertence à conta atual.' };
    }

    const basePrice = Number(item.price);
    if (!isFinite(basePrice) || basePrice <= 0) {
      return { success:false, mlb_id: mlbId, error: 'Preço base inválido no item.' };
    }
    const dealPrice = arred2(basePrice * (1 - (Number(percent)/100)));

    // 3) tentar criar a promoção (PRICE_DISCOUNT)
    // endpoint mais comum: POST /seller-promotions/items/:mlb?app_version=v2
    const attemptBodies = [
      { type: 'PRICE_DISCOUNT', discount_type: 'PERCENTAGE', discount_value: Number(percent) },
      { type: 'PRICE_DISCOUNT', value_type: 'percentage', value: Number(percent) },
      { promotion_type: 'PRICE_DISCOUNT', percentage: Number(percent) },
      { type: 'PRICE_DISCOUNT', deal_price: dealPrice }, // algumas variantes aceitam preço final direto
    ];

    let lastError = null;
    for (const body of attemptBodies) {
      const resp = await withAuth(`${U.sellerPromos}/items/${mlbId}?app_version=v2`, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(body),
      }, state);

      if (resp.ok) {
        let apiData = {};
        try { apiData = await resp.json(); } catch {}
        return {
          success: true,
          message: 'Desconto aplicado!',
          mlb_id: mlbId,
          applied_percent: Number(percent),
          base_price: basePrice,
          deal_price: dealPrice,
          api: apiData,
        };
      } else {
        let errTxt = '';
        try { errTxt = await resp.text(); } catch {}
        lastError = `HTTP ${resp.status} ${errTxt}`;
        // tenta próxima forma
      }
    }

    return {
      success:false,
      mlb_id: mlbId,
      error: lastError || 'Falha ao criar promoção (PRICE_DISCOUNT).',
      base_price: basePrice,
      deal_price: dealPrice,
      applied_percent: Number(percent),
    };
  }
}

module.exports = CriarPromocaoService;
