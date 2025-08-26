// controllers/PromocoesController.js
const fetch = require('node-fetch');
const TokenService = require('../services/tokenService');
const config = require('../config/config');

// URLs com fallback para valores padrão
function U() {
  return {
    users_me:        (config?.urls?.users_me) || 'https://api.mercadolibre.com/users/me',
    items:           (config?.urls?.items) || 'https://api.mercadolibre.com/items',
    sellerPromoBase: (config?.urls?.seller_promotions) || 'https://api.mercadolibre.com/seller-promotions',
  };
}

// Cria "state" de autenticação alinhado ao seu TokenService
async function prepareAuth(res) {
  const creds = res?.locals?.mlCreds || {}; // vem do ensureAccount
  const token = await TokenService.renovarTokenSeNecessario(creds); // valida/renova conforme seu padrão
  return { token, creds, key: (creds.account_key || creds.accountKey || 'sem-conta') };
}

// fetch com Authorization + retry único em 401 (mesma estratégia do remover promoção)
async function authFetch(url, init, state) {
  const call = async (tok) =>
    fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}` } });

  let resp = await call(state.token);
  if (resp.status !== 401) return resp;

  const renewed = await TokenService.renovarToken(state.creds); // força refresh
  state.token = renewed.access_token;
  return call(state.token);
}

class PromocoesController {
  // GET /api/promocoes/users
  static async users(req, res) {
    try {
      const state = await prepareAuth(res);
      const urls = U();

      // 1) Descobre user_id
      const rMe = await authFetch(urls.users_me, { method: 'GET' }, state);
      if (!rMe.ok) {
        const body = await rMe.text().catch(()=>'');
        return res.status(rMe.status).json({ ok:false, step:'users/me', body });
      }
      const me = await rMe.json();
      const userId = me.id;

      // 2) Lista promoções do usuário
      const q = new URLSearchParams({ app_version: 'v2' });
      const rUsers = await authFetch(`${urls.sellerPromoBase}/users/${userId}?${q}`, { method:'GET' }, state);
      const raw = await rUsers.text();
      let json;
      try { json = JSON.parse(raw); } catch { json = { raw }; }

      return res.status(rUsers.status).send(json);
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok:false, error: e?.message || String(e) });
    }
  }

  // GET /api/promocoes/promotions/:promotionId/items
  static async promotionItems(req, res) {
    try {
      const state = await prepareAuth(res);
      const urls = U();

      const { promotionId } = req.params;
      if (!promotionId) return res.status(400).json({ ok:false, error:'promotionId ausente' });

      const {
        promotion_type = 'DEAL',
        status,
        limit = 50,
        search_after
      } = req.query;

      const qs = new URLSearchParams({ promotion_type, app_version:'v2' });
      if (status) qs.set('status', status);
      if (limit) qs.set('limit', String(limit));
      if (search_after) qs.set('search_after', String(search_after));

      // 1) Itens da campanha
      const r = await authFetch(
        `${urls.sellerPromoBase}/promotions/${encodeURIComponent(promotionId)}/items?${qs}`,
        { method:'GET' }, state
      );
      const promoJson = await r.json().catch(()=>({}));

      const results = Array.isArray(promoJson.results) ? promoJson.results : [];
      if (!results.length) return res.json(promoJson);

      // 2) Enriquecimento batendo no /items?ids=...
      const ids = results.map(x => x.id).filter(Boolean);
      const chunks = [];
      for (let i=0;i<ids.length;i+=20) chunks.push(ids.slice(i, i+20));
      const details = {};
      for (const pack of chunks) {
        const rr = await authFetch(
          `${urls.items}?ids=${pack.join(',')}&attributes=id,title,available_quantity,seller_custom_field,price`,
          { method:'GET' }, state
        );
        const blob = await rr.json().catch(()=>[]);
        (blob||[]).forEach(row=>{
          const b = row?.body || {};
          if (b?.id) details[b.id] = {
            title: b.title,
            available_quantity: b.available_quantity,
            seller_custom_field: b.seller_custom_field,
            price: b.price
          };
        });
      }

      // 3) Merge e cálculo de desconto quando faltar
      const merged = results.map(r => {
        const d = details[r.id] || {};
        const original = r.original_price ?? d.price ?? null;
        const deal     = r.price ?? null;
        let discount   = r.discount_percentage;
        if ((discount == null) && original && deal && Number(original) > 0) {
          discount = (1 - (Number(deal)/Number(original))) * 100;
        }
        return {
          ...r,
          title: d.title,
          available_quantity: d.available_quantity,
          seller_custom_field: d.seller_custom_field,
          original_price: original,
          deal_price: deal,
          discount_percentage: discount
        };
      });

      return res.json({ ...promoJson, results: merged });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok:false, error: e?.message || String(e) });
    }
  }
}

module.exports = PromocoesController;
