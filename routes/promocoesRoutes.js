// routes/promocoesRoutes.js
const express = require('express');
const fetch = require('node-fetch');
const TokenService = require('../services/tokenService');

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
 * CONSULTA AS PROMOÇÕES DE UM ITEM (array bruto do ML)
 * GET /api/promocoes/items/:itemId
 * -> Proxy para https://api.mercadolibre.com/seller-promotions/items/:ITEM_ID?app_version=v2
 */
core.get('/api/promocoes/items/:itemId', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { itemId } = req.params;
    const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;

    const r = await authFetch(req, url, {}, creds);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    // Normalizamos uma resposta vazia para []
    const promotions = Array.isArray(json) ? json : (Array.isArray(json.results) ? json.results : []);
    return res.status(r.status).json(promotions);
  } catch (e) {
    console.error('[/api/promocoes/items/:itemId] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * Itens de uma promoção (com enriquecimento de título/sku/price)
 * GET /api/promocoes/promotions/:promotionId/items
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
    if (results.length === 0) return res.json(promoJson);

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
        ...r, // mantém offer_id, status etc.
        title: d.title,
        available_quantity: d.available_quantity,
        seller_custom_field: d.seller_custom_field,
        original_price: original,
        deal_price: deal,
        discount_percentage: discount,
      };
    });

    return res.json({ ...promoJson, results: merged });
  } catch (e) {
    console.error('[/api/promocoes/promotions/:id/items] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * APLICAR ITENS A UMA PROMOÇÃO
 * POST /api/promocoes/apply
 * body: { promotion_id, promotion_type, items: [{ id, deal_price?, top_deal_price?, offer_id? }] }
 *
 * Regras por tipo (com base na doc que você enviou):
 * - MARKETPLACE_CAMPAIGN: POST /seller-promotions/items/:ITEM_ID  {promotion_id, promotion_type}
 * - SMART / PRICE_MATCHING: POST ... {promotion_id, promotion_type, offer_id}
 * - SELLER_CAMPAIGN: POST ... {promotion_id, promotion_type, deal_price, top_deal_price?}
 * - DEAL (campanhas tradicionais): POST ... {promotion_id, promotion_type, deal_price, top_deal_price?}
 * - PRICE_MATCHING_MELI_ALL: participação 100% ML → não aplicamos via API (retornamos 400)
 */
core.post('/api/promocoes/apply', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { promotion_id, promotion_type, items } = req.body || {};
    const type = String(promotion_type || '').toUpperCase();

    if (!promotion_id || !promotion_type || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Parâmetros inválidos', body: { promotion_id, promotion_type, items_len: items?.length }});
    }

    if (type === 'PRICE_MATCHING_MELI_ALL') {
      return res.status(400).json({ ok: false, error: 'PRICE_MATCHING_MELI_ALL é 100% ML. Aplicação manual indisponível.' });
    }

    const results = [];
    for (const it of items) {
      const itemId = it.id;
      if (!itemId) {
        results.push({ id: null, ok: false, status: 400, error: 'Item sem id' });
        continue;
      }

      // monta o corpo conforme o tipo
      let payload = { promotion_id, promotion_type: type };

      if (type === 'MARKETPLACE_CAMPAIGN') {
        // nada além do promotion_id/type
      } else if (type === 'SMART' || type === 'PRICE_MATCHING') {
        if (!it.offer_id) {
          results.push({ id: itemId, ok: false, status: 400, error: 'offer_id obrigatório para SMART/PRICE_MATCHING' });
          continue;
        }
        payload.offer_id = it.offer_id;
      } else if (type === 'SELLER_CAMPAIGN' || type === 'DEAL' || type === 'PRICE_DISCOUNT' || type === 'DOD') {
        if (it.deal_price == null) {
          results.push({ id: itemId, ok: false, status: 400, error: 'deal_price obrigatório para este tipo de campanha' });
          continue;
        }
        payload.deal_price = Number(it.deal_price);
        if (it.top_deal_price != null) payload.top_deal_price = Number(it.top_deal_price);
      } else {
        // fallback seguro: se veio deal_price, envia; se veio offer_id, envia
        if (it.offer_id) payload.offer_id = it.offer_id;
        if (it.deal_price != null) payload.deal_price = Number(it.deal_price);
        if (it.top_deal_price != null) payload.top_deal_price = Number(it.top_deal_price);
      }

      const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
      const upstream = await authFetch(req, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, creds);

      const text = await upstream.text().catch(()=>'');
      let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

      results.push({
        id: itemId,
        ok: upstream.ok,
        status: upstream.status,
        body: json
      });
    }

    const allOk = results.every(r => r.ok);
    return res.status(allOk ? 200 : 207).json({ ok: allOk, results });
  } catch (e) {
    console.error('[/api/promocoes/apply] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// === APLICAR UM ITEM EM UMA CAMPANHA ===
// POST /api/promocoes/items/:itemId/apply
// Body: { promotion_id, promotion_type, offer_id?, deal_price?, top_deal_price? }
core.post('/api/promocoes/items/:itemId/apply', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { itemId } = req.params;

    const {
      promotion_id,
      promotion_type,
      offer_id,
      deal_price,
      top_deal_price
    } = req.body || {};

    if (!promotion_id || !promotion_type) {
      return res.status(400).json({ ok: false, error: 'promotion_id e promotion_type são obrigatórios.' });
    }

    const t = String(promotion_type).toUpperCase();
    const payload = { promotion_id, promotion_type: t };

    // Regras por tipo (conforme documentação ML)
    if (t === 'SMART' || t.startsWith('PRICE_MATCHING')) {
      if (!offer_id) {
        return res.status(400).json({ ok: false, error: 'offer_id é obrigatório para SMART/PRICE_MATCHING.' });
      }
      payload.offer_id = offer_id;
    } else if (t === 'SELLER_CAMPAIGN' || t === 'DEAL') {
      if (deal_price == null) {
        return res.status(400).json({ ok: false, error: 'deal_price é obrigatório para SELLER_CAMPAIGN/DEAL.' });
      }
      payload.deal_price = Number(deal_price);
      if (top_deal_price != null) payload.top_deal_price = Number(top_deal_price);
    } else if (t === 'MARKETPLACE_CAMPAIGN') {
      // sem campos adicionais
    }

    const mlUrl = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
    const r = await authFetch(req, mlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, creds);

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return res.status(r.status).send(json);
  } catch (e) {
    console.error('[/api/promocoes/items/:itemId/apply] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});
// ===== NOVO: seleção global + job em massa =====
const PromoSelectionStore = require('../services/promoSelectionStore');
let PromoJobsService = null;
try { PromoJobsService = require('../services/promoJobsService'); } catch { PromoJobsService = null; }

/**
 * Prepara seleção global (conta quantos itens a partir dos filtros) e devolve token.
 * Body: { promotion_id, promotion_type, status, percent_min, percent_max }
 */
core.post('/api/promocoes/selection/prepare', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const accountKey = String(res.locals.accountKey || 'default');
    const { promotion_id, promotion_type, status, percent_min, percent_max } = req.body || {};
    if (!promotion_id || !promotion_type) {
      return res.status(400).json({ ok:false, error:'promotion_id e promotion_type são obrigatórios' });
    }

    // Conta rápido paginando
    let total = 0;
    let next = null;
    const qsBase = new URLSearchParams();
    qsBase.set('promotion_type', String(promotion_type));
    if (status) qsBase.set('status', String(status));
    qsBase.set('limit', '50');
    qsBase.set('app_version','v2');

    const num = (v) => (v==null?null:Number(v));
    const min = num(percent_min); const max = num(percent_max);

    for (let guard=0; guard<500; guard++) { // máx 25k itens
      const qs = new URLSearchParams(qsBase);
      if (next) qs.set('search_after', String(next));
      const url = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(promotion_id)}/items?${qs.toString()}`;
      const r = await authFetch(req, url, {}, creds);
      if (!r.ok) break;
      const j = await r.json().catch(()=>({}));
      const rows = Array.isArray(j.results)? j.results : [];
      rows.forEach(it => {
        const original = it.original_price ?? null;
        let p = it.price ?? it.top_deal_price ?? it.min_discounted_price ?? it.suggested_discounted_price ?? null;
        let pct = (original && p) ? (1 - (Number(p)/Number(original)))*100 : null;
        if (min!=null && (pct==null || pct < min)) return;
        if (max!=null && (pct==null || pct > max)) return;
        total++;
      });
      next = j?.paging?.next_token || null;
      if (!next || rows.length === 0) break;
    }

    const { token } = await PromoSelectionStore.saveSelection({
      accountKey,
      data: { promotion_id, promotion_type, status, percent_min, percent_max },
      total
    });

    return res.json({ ok:true, token, total });
  } catch (e) {
    console.error('[/api/promocoes/selection/prepare] erro:', e);
    return res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});

/**
 * Dispara job em massa (apply/remove) a partir do token da seleção preparada.
 * Body: { token, action: "apply"|"remove", values?: {...} }
 */
core.post('/api/promocoes/jobs/apply-mass', async (req, res) => {
  try {
    if (!PromoJobsService) return res.status(503).json({ ok:false, error:'PromoJobsService indisponível' });
    const accountKey = String(res.locals.accountKey || 'default');
    const { token, action, values } = req.body || {};
    if (!token || !action) return res.status(400).json({ ok:false, error:'token e action são obrigatórios' });

    const meta = await PromoSelectionStore.getMeta(token);
    const job = await PromoJobsService.enqueueApplyMass({
      token, action, values: values||{}, accountKey,
      expected_total: meta?.total || 0
    });
    return res.json({ ok:true, job_id: job?.id || null });
  } catch (e) {
    console.error('[/api/promocoes/jobs/apply-mass] erro:', e);
    return res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});


// ---- Montagem do router com aliases
const router = express.Router();
router.use(core);                    // /api/promocoes/*
router.use('/api/promocao', core);   // alias
router.use('/api/promotions', core); // alias
module.exports = router;
