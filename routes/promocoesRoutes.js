// routes/promocoesRoutes.js
const express = require('express');
const fetch = require('node-fetch');
const TokenService = require('../services/tokenService');

const router = express.Router();
const core = express.Router();

/** Fetch com Authorization + 1 tentativa de renovação em 401 */
async function authFetch(req, url, init = {}, creds = {}) {
  let token = req?.access_token || null;
  if (!token) token = await TokenService.renovarTokenSeNecessario(creds);

  const call = async (tkn) => {
    const headers = { ...(init.headers || {}), Authorization: `Bearer ${tkn}` };
    return fetch(url, { ...init, headers });
  };

  let resp = await call(token);
  if (resp.status !== 401) return resp;

  // tenta renovar e refaz uma vez
  const renewed = await TokenService.renovarToken(creds);
  const newToken = renewed?.access_token;
  return call(newToken);
}

/** Lista promoções disponíveis para o vendedor atual */
core.get('/api/promocoes/users', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const meResp = await authFetch(req, 'https://api.mercadolibre.com/users/me', {}, creds);
    if (!meResp.ok) {
      const t = await meResp.text();
      return res.status(meResp.status).json({ ok: false, step: 'users/me', body: t });
    }
    const me = await meResp.json();
    const userId = me.id;

    const url = `https://api.mercadolibre.com/seller-promotions/users/${userId}?app_version=v2`;
    const pr = await authFetch(req, url, {}, creds);
    const body = await pr.text();

    let json;
    try { json = JSON.parse(body); } catch { json = { raw: body }; }
    return res.status(pr.status).send(json);
  } catch (e) {
    console.error('[/api/promocoes/users] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * Promoções de um ITEM (MLB)
 * Proxy para: GET seller-promotions/items/:ITEM_ID?app_version=v2
 * Resposta normalizada: { ok:true, results:[ ... ] }
 */
core.get('/api/promocoes/items/:itemId/promotions', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { itemId } = req.params;
    const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;

    const r = await authFetch(req, url, {}, creds);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const results = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
    return res.status(r.status).json({ ok: true, results });
  } catch (e) {
    console.error('[/api/promocoes/items/:itemId/promotions] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * Itens de uma promoção (com enriquecimento básico)
 * Proxy para: GET seller-promotions/promotions/:promotionId/items
 */
core.get('/api/promocoes/promotions/:promotionId/items', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { promotionId } = req.params;
    const { promotion_type = 'DEAL', status, limit = 50, search_after } = req.query;

    const qs = new URLSearchParams();
    qs.set('promotion_type', promotion_type);
    if (status) qs.set('status', status);
    if (limit) qs.set('limit', String(limit));
    if (search_after) qs.set('search_after', String(search_after));
    qs.set('app_version', 'v2');

    const url = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(promotionId)}/items?${qs.toString()}`;
    const pr = await authFetch(req, url, {}, creds);
    const promoJson = await pr.json();

    const results = Array.isArray(promoJson.results) ? promoJson.results : [];
    if (!results.length) return res.json(promoJson);

    // Enriquecimento (detalhes do item)
    const ids = results.map(r => r.id).filter(Boolean);
    const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a[a.length - 1].push(arr[i]) : a.push([arr[i]]), a), []);
    const packs = chunk(ids, 20);
    const details = {};

    for (const pack of packs) {
      const urlItems = `https://api.mercadolibre.com/items?ids=${pack.join(',')}&attributes=id,title,available_quantity,seller_custom_field,price`;
      const ir = await authFetch(req, urlItems, {}, creds);
      const blob = await ir.json();
      (blob || []).forEach((row) => {
        const b = row.body || {};
        if (b.id) {
          details[b.id] = {
            title: b.title,
            available_quantity: b.available_quantity,
            seller_custom_field: b.seller_custom_field,
            price: b.price,
          };
        }
      });
    }

    const merged = results.map((r) => {
      const d = details[r.id] || {};
      const original = r.original_price ?? d.price ?? null;
      const deal = r.price ?? null;
      let discount = r.discount_percentage;
      if ((discount == null) && original && deal && Number(original) > 0) {
        discount = (1 - (Number(deal) / Number(original))) * 100;
      }
      return {
        ...r,
        title: d.title,
        available_quantity: d.available_quantity,
        sku: d.seller_custom_field,
        original_price: original,
        deal_price: deal,
        discount_percentage: discount,
      };
    });

    return res.json({ ...promoJson, results: merged });
  } catch (e) {
    console.error('[/api/promocoes/promotions/:promotionId/items] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Montagem do router com aliases
router.use(core);                    // /api/promocoes/*
router.use('/api/promocao', core);   // alias
router.use('/api/promotions', core); // alias

module.exports = router;
