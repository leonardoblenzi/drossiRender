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

async function withAuth(url, init, state) {
  const call = async (token) => {
    const headers = { ...(init?.headers||{}), Authorization: `Bearer ${token}` };
    return fetch(url, { ...init, headers });
  };
  let resp = await call(state.token);
  if (resp.status !== 401) return resp;
  const novo = await TokenService.renovarToken(state.creds);
  state.token = novo.access_token;
  return call(state.token);
}

async function prepararAuth(opts = {}) {
  const creds = resolveCreds(opts);
  const token = await TokenService.renovarTokenSeNecessario(creds);
  return { token, creds, key: creds.accountKey || 'sem-conta' };
}

function arred2(n) { return Math.round(Number(n) * 100) / 100; }

class CriarPromocaoService {
  static async aplicarDescontoUnico(mlbId, percent, options = {}) {
    const state = await prepararAuth(options);
    const U = urls();
    const baseHeaders = { 'content-type': 'application/json' };

    // 1) dados do item
    const rItem = await withAuth(`${U.items}/${mlbId}`, { method:'GET' }, state);
    if (!rItem.ok) {
      const tx = await rItem.text().catch(()=> '');
      return { success:false, mlb_id: mlbId, error: `Falha ao obter item: HTTP ${rItem.status} ${tx}` };
    }
    const item = await rItem.json();

    // 2) valida dono
    const rMe = await withAuth(U.users_me, { method:'GET' }, state);
    if (!rMe.ok) {
      const tx = await rMe.text().catch(()=> '');
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

    // 3) criar promoção (PRICE_DISCOUNT) — prioriza deal_price (doc atual)
    const attemptBodies = [
      { promotion_type: 'PRICE_DISCOUNT', deal_price: dealPrice },
      // { promotion_type: 'PRICE_DISCOUNT', deal_price: dealPrice, top_deal_price: dealPriceVip }, // opcional
      { type: 'PRICE_DISCOUNT', deal_price: dealPrice },
      { type: 'PRICE_DISCOUNT', discount_type: 'PERCENTAGE', discount_value: Number(percent) },
      { type: 'PRICE_DISCOUNT', value_type: 'percentage', value: Number(percent) },
      { promotion_type: 'PRICE_DISCOUNT', percentage: Number(percent) },
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
