// routes/promocoesRoutes.js
const express = require('express');
const fetch = require('node-fetch');
const TokenService = require('../services/tokenService');

// Serviços opcionais (se existirem)
let PromoJobsService = null;
try { PromoJobsService = require('../services/promoJobsService'); } catch { PromoJobsService = null; }

// Adapter para remoção em massa (reutiliza seu services/promocaoService.js)
let PromoBulkRemove = null;
try { PromoBulkRemove = require('../services/promoBulkRemoveAdapter'); } catch { PromoBulkRemove = null; }

// Store de seleção (fase 2)
let PromoSelectionStore = null;
try { PromoSelectionStore = require('../services/promoSelectionStore'); } catch { PromoSelectionStore = null; }

const core = express.Router();

/** Fetch com Authorization + 1 tentativa de renovação em 401 */
async function authFetch(req, url, init = {}, creds = {}) {
  let token = req?.access_token || null;
  if (!token) token = await TokenService.renovarTokenSeNecessario(creds);

  const call = async (tkn) => {
    const headers = {
      Accept: 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${tkn}`
    };
    return fetch(url, { ...init, headers });
  };

  let resp = await call(token);
  if (resp.status !== 401) return resp;

  const renewed = await TokenService.renovarToken(creds);
  const newToken = renewed?.access_token;
  return call(newToken);
}

/** Helper: lotear array */
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Heurística única para resolver preço final e % em DEAL/SELLER
 * Lida com o caso em que "price" vem como DESCONTO EM R$ (e não preço final).
 * Permite ajustar limiares por env:
 * - ML_DEAL_MAX_GAP=0.70 (gap máximo aceitável entre original e final)
 */
// ===== Helper DEAL/SELLER: escolhe preço final e % com regras seguras
function resolveDealFinalAndPct(raw) {
  const orig = Number(raw.original_price || raw.originalPrice || raw.price || 0);
  const status = String(raw.status || '').toLowerCase();

  const deal = Number(raw.deal_price || raw.new_price || 0);
  const minD = Number(raw.min_discounted_price || 0);
  const sugD = Number(raw.suggested_discounted_price || 0);
  const maxD = Number(raw.max_discounted_price || 0);
  const px   = Number(raw.price || 0); // pode ser PREÇO FINAL ou DESCONTO em R$
  const mlPct = Number(raw.discount_percentage || raw.discountPercent || NaN);

  if (!orig || !isFinite(orig) || orig <= 0) return { final: null, pct: null };

  // Limites seguros (ajustáveis por env)
  const GAP = Number(process.env.ML_DEAL_MAX_GAP || 0.70);             // 70% de gap para validar "preço final"
  const PCT_MIN = Number(process.env.ML_DEAL_PLAUSIBLE_PCT_MIN || 5);   // 5%
  const PCT_MAX = Number(process.env.ML_DEAL_PLAUSIBLE_PCT_MAX || 40);  // 40%
  const ALLOW_ML_PCT_FALLBACK = String(process.env.ML_DEAL_ALLOW_ML_PERCENT_FALLBACK || 'true') === 'true';

  const isPlausibleFinal  = (v) => isFinite(v) && v > 0 && v < orig && (orig - v) / orig < GAP;
  const isPlausiblePct    = (p) => isFinite(p) && p >= PCT_MIN && p <= PCT_MAX;

  const isCandLike = (status === 'candidate' || status === 'scheduled' || status === 'pending');
  const noSuggestions = !(isFinite(sugD) && sugD > 0) && !(isFinite(minD) && minD > 0) && !(isFinite(maxD) && maxD > 0);

  let final = null;

  // 1) started => confiar no deal/new_price
  if (status === 'started' && isPlausibleFinal(deal)) final = deal;

  // 2) sempre preferir suggested -> min -> max
  if (!final) {
    if (isPlausibleFinal(sugD)) final = sugD;
    if (!final && isPlausibleFinal(minD)) final = minD;
    if (!final && isPlausibleFinal(maxD)) final = maxD;
  }

  // 3) CANDIDATE-like sem sugestões: se price>0, tratar como DESCONTO EM R$
  if (!final && isCandLike && noSuggestions && isFinite(px) && px > 0) {
    const pctFromPrice = (px / orig) * 100;
    if (isPlausiblePct(pctFromPrice)) {
      const candidateFinal = orig - px;
      if (isPlausibleFinal(candidateFinal)) {
        final = candidateFinal; // usamos desconto em R$
      }
    }
  }

  // 4) fallback opcional com % do ML (quando não há sugestões e price==0)
  if (!final && isCandLike && noSuggestions && (!isFinite(px) || px === 0) && ALLOW_ML_PCT_FALLBACK && isPlausiblePct(mlPct)) {
    const est = orig * (1 - mlPct / 100);
    if (isPlausibleFinal(est)) final = est;
  }

  // 5) fora de candidate-like, podemos ainda aceitar px como final plausível
  if (!final && !isCandLike && isFinite(px) && px > 0 && isPlausibleFinal(px)) final = px;

  if (!final) return { final: null, pct: null };
  const pct = Math.max(0, Math.min(100, ((orig - final) / orig) * 100));
  return { final: Number(final.toFixed(2)), pct: Number(pct.toFixed(2)) };
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
 * RESOLVE OFFER IDS PARA UM ITEM (MLB)
 * GET /api/promocoes/items/:itemId/offer-ids
 * -> { ok:true, offer_ids:["OFFER-..."] } | { ok:false, error:"offer_id_not_found" }
 */
core.get('/api/promocoes/items/:itemId/offer-ids', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { itemId } = req.params;

    const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
    const r = await authFetch(req, url, {}, creds);
    const text = await r.text().catch(() => '');
    let arr; try { arr = JSON.parse(text); } catch { arr = []; }

    const promos = Array.isArray(arr) ? arr : (Array.isArray(arr?.results) ? arr.results : []);
    const set = new Set();

    for (const p of promos) {
      if (Array.isArray(p?.offers)) {
        for (const o of p.offers) {
          const oid = o?.offer_id || o?.id;
          if (oid) set.add(String(oid));
        }
      }
      if (p?.offer_id) set.add(String(p.offer_id));
    }

    const out = [...set];
    if (!out.length) return res.status(404).json({ ok: false, error: 'offer_id_not_found' });

    return res.json({ ok: true, offer_ids: out });
  } catch (e) {
    console.error('[/api/promocoes/items/:itemId/offer-ids] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * Itens de uma promoção (com enriquecimento de título/sku/price)
 * GET /api/promocoes/promotions/:promotionId/items
 *
 * Normaliza paginação para sempre expor paging.searchAfter
 * (aceita searchAfter | next_token | search_after do ML)
 *
 * 🔧 PATCH: DEAL/SELLER_CAMPAIGN
 * - Traz min_discounted_price / suggested_discounted_price / max_discounted_price
 * - Calcula discount_percentage quando não vier do ML:
 *    • se houver deal_price (started), usa deal_price/original_price
 *    • senão, usa candidato do ML (min -> suggested -> max) para estimar o %  
 */
core.get('/api/promocoes/promotions/:promotionId/items', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { promotionId } = req.params;
    const { promotion_type = 'DEAL', status, limit = 50, search_after } = req.query;

    const qs = new URLSearchParams();
    qs.set('promotion_type', String(promotion_type));
    if (status) qs.set('status', String(status));
    if (limit) qs.set('limit', String(limit));
    if (search_after) qs.set('search_after', String(search_after));
    qs.set('app_version', 'v2');

    const url = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(promotionId)}/items?${qs.toString()}`;
    const pr = await authFetch(req, url, {}, creds);
    const promoJson = await pr.json().catch(() => ({}));

    const results = Array.isArray(promoJson.results) ? promoJson.results : [];
    const pagingIn = promoJson.paging || {};

    if (results.length === 0) {
      return res.json({
        ...promoJson,
        paging: {
          ...pagingIn,
          searchAfter: pagingIn.searchAfter ?? pagingIn.next_token ?? pagingIn.search_after ?? null
        }
      });
    }

    // Helpers
    const normStatus = (s) => {
      s = String(s || '').toLowerCase();
      if (s === 'in_progress') return 'pending';
      return s;
    };
    const isDealLike = (t) => ['DEAL','SELLER_CAMPAIGN','PRICE_DISCOUNT','DOD'].includes(String(t||'').toUpperCase());

    // Enriquecimento com /items (title/estoque/sku/price)
    const ids = results.map(r => r.id || r.item_id).filter(Boolean);
    const pack = (arr, n) => { const out = []; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; };
    const itemsDetails = {};

    for (const group of pack(ids, 20)) {
      const urlItems = `https://api.mercadolibre.com/items?ids=${encodeURIComponent(group.join(','))}&attributes=${encodeURIComponent('id,title,available_quantity,seller_custom_field,price')}`;
      const ir = await authFetch(req, urlItems, {}, creds);
      if (!ir.ok) continue;
      const blob = await ir.json().catch(() => []);
      (Array.isArray(blob)? blob:[]).forEach((row) => {
        const b = row?.body || row || {};
        if (b?.id) {
          itemsDetails[b.id] = {
            title: b.title,
            available_quantity: b.available_quantity,
            seller_custom_field: b.seller_custom_field,
            price: b.price,
          };
        }
      });
    }

    const merged = results.map((r) => {
      const id = r.id || r.item_id;
      const d  = itemsDetails[id] || {};
      const typeUp = String(r.type || promotion_type || '').toUpperCase();

      // original: da promoção, senão do item
      const original = (r.original_price != null) ? Number(r.original_price)
                      : (d.price != null) ? Number(d.price)
                      : null;

      // Resolver final e % com a heurística única (corrige "price" como desconto em R$)
      const { final, pct } = resolveDealFinalAndPct({
        original_price: original,
        status: r.status,
        deal_price: r.deal_price ?? r.new_price,
        min_discounted_price: r.min_discounted_price,
        suggested_discounted_price: r.suggested_discounted_price,
        max_discounted_price: r.max_discounted_price,
        price: r.price,
        discount_percentage: r.discount_percentage
      });

      const st = normStatus(r.status);

      return {
        ...r,
        id,
        title: d.title,
        available_quantity: d.available_quantity,
        seller_custom_field: d.seller_custom_field,

        original_price: original,
        // Só expõe deal_price quando started; em candidate mostramos candidatos
        deal_price: (st === 'started' ? (final ?? null) : null),

        // garantir números (ou null) p/ suggested/min/max
        min_discounted_price: (r.min_discounted_price != null ? Number(r.min_discounted_price) : null),
        suggested_discounted_price: (r.suggested_discounted_price != null ? Number(r.suggested_discounted_price) : null),
        max_discounted_price: (r.max_discounted_price != null ? Number(r.max_discounted_price) : null),

        // % final coerente com a lógica do front
        discount_percentage: (isDealLike(typeUp)
          ? (pct != null ? pct : null)
          : (r.discount_percentage != null
              ? Number(r.discount_percentage)
              : (original && final ? Number(((1 - final / original) * 100).toFixed(2)) : null))),

        status: st,

        // útil para debug/validação
        _resolved_final_price: (final ?? null)
      };
    });

    return res.json({
      ...promoJson,
      results: merged,
      paging: {
        ...pagingIn,
        searchAfter: pagingIn.searchAfter ?? pagingIn.next_token ?? pagingIn.search_after ?? null
      }
    });
  } catch (e) {
    console.error('[/api/promocoes/promotions/:id/items] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});


/**
 * APLICAR ITENS A UMA PROMOÇÃO (lote)
 * POST /api/promocoes/apply
 * body: { promotion_id, promotion_type, items: [{ id, deal_price?, top_deal_price?, offer_id? }] }
 */
core.post('/api/promocoes/apply', async (req, res) => {
  try {
    const creds = res.locals.mlCreds || {};
    const { promotion_id, promotion_type, items } = req.body || {};
    const type = String(promotion_type || '').toUpperCase();

    if (!promotion_id || !promotion_type || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Parâmetros inválidos', body: { promotion_id, promotion_type, items_len: items?.length } });
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

      let payload = { promotion_id, promotion_type: type };

      if (type === 'MARKETPLACE_CAMPAIGN') {
        // nada além de id/type
      } else if (type === 'SMART' || type === 'PRICE_MATCHING' || type.startsWith('PRICE_MATCHING')) {
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
        // fallback: se veio deal_price/offer_id, envia
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

      const text = await upstream.text().catch(() => '');
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

// APLICAR UM ITEM EM UMA CAMPANHA
// POST /api/promocoes/items/:itemId/apply
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

    if (t === 'SMART' || t.startsWith('PRICE_MATCHING')) {
      if (!offer_id) {
        return res.status(400).json({ ok: false, error: 'offer_id é obrigatório para SMART/PRICE_MATCHING.' });
      }
      payload.offer_id = offer_id;
    } else if (t === 'SELLER_CAMPAIGN' || t === 'DEAL' || t === 'PRICE_DISCOUNT' || t === 'DOD') {
      if (deal_price == null) {
        return res.status(400).json({ ok: false, error: 'deal_price é obrigatório para este tipo de campanha.' });
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
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return res.status(r.status).send(json);
  } catch (e) {
    console.error('[/api/promocoes/items/:itemId/apply] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/* ===========================================================
 * NOVO ENDPOINT: aplicar em massa TODOS OS FILTRADOS (backend job)
 * compatível com o front: POST /api/promocoes/promotions/:promotionId/apply-bulk
 * Body:
 * {
 *   "promotion_type": "DEAL|SELLER_CAMPAIGN|SMART|PRICE_MATCHING|PRICE_MATCHING_MELI_ALL|MARKETPLACE_CAMPAIGN|PRICE_DISCOUNT|DOD",
 *   "filters": { "query_mlb": "...", "status": "candidate|started|all", "discount_max": 15 },
 *   "price_policy": "min"|"suggested"|"max",
 *   "options": { "dryRun": false, "expected_total": 123 }
 * }
 * =========================================================== */
// POST /api/promocoes/promotions/:promotionId/apply-bulk
core.post('/api/promocoes/promotions/:promotionId/apply-bulk', async (req, res) => {
  try {
    if (!PromoJobsService || typeof PromoJobsService.enqueueBulkApply !== 'function') {
      return res.status(503).json({ success: false, error: 'PromoJobsService indisponível' });
    }
    PromoJobsService.init?.();

    const creds = res.locals.mlCreds || {};
    const accountKey = res.locals.accountKey || 'default';

    // pega :promotionId da URL e usa como promotion_id internamente
    const { promotionId: promotion_id } = req.params || {};
    const { promotion_type, filters: fIn = {}, options = {} } = req.body || {};

    if (!promotion_id || !promotion_type) {
      return res.status(400).json({ success: false, error: 'promotionId e promotion_type são obrigatórios' });
    }

    const t = String(promotion_type).toUpperCase();
    const allowed = new Set(['DEAL','SELLER_CAMPAIGN','SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL','MARKETPLACE_CAMPAIGN']);
    if (!allowed.has(t)) {
      return res.status(400).json({ success: false, error: `promotion_type inválido: ${t}` });
    }

    // normaliza filtros do front
    const filters = {
      status: (fIn.status && String(fIn.status).toLowerCase() !== 'all') ? String(fIn.status) : null,
      maxDesc: (fIn.discount_max != null ? Number(fIn.discount_max)
               : (fIn.maxDesc != null ? Number(fIn.maxDesc) : null)),
      mlb: fIn.query_mlb ?? fIn.mlb ?? null
    };

    const jobId = await PromoJobsService.enqueueBulkApply({
      mlCreds: creds,
      accountKey,
      action: 'apply',
      promotion: { id: String(promotion_id), type: t },
      filters,
      price_policy: 'min',
      options: { dryRun: !!options.dryRun, expected_total: options.expected_total ?? null }
    });

    return res.json({ success: true, job_id: jobId });
  } catch (e) {
    console.error('[/api/promocoes/promotions/:promotionId/apply-bulk] erro:', e);
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});


// === PREPARAR JOB EM MASSA (todas as páginas/filtrados) – caminho legado ===
core.post('/api/promocoes/bulk/prepare', async (req, res) => {
  try {
    if (!PromoJobsService || typeof PromoJobsService.enqueueBulkApply !== 'function') {
      return res.status(503).json({ ok: false, error: 'PromoJobsService indisponível' });
    }
    PromoJobsService.init?.();

    const creds = res.locals.mlCreds || {};
    const accountKey = res.locals.accountKey || 'default';

    const {
      action = 'apply',                       // 'apply' | 'remove'
      promotion_id,
      promotion_type,
      filters = {},                           // { status, maxDesc, mlb }
      price_policy = 'min'                    // 'min' | 'suggested' | 'max'
    } = req.body || {};

    if (!promotion_id || !promotion_type) {
      return res.status(400).json({ ok: false, error: 'promotion_id e promotion_type são obrigatórios.' });
    }

    const jobId = await PromoJobsService.enqueueBulkApply({
      mlCreds: creds,
      accountKey,
      action,
      promotion: { id: promotion_id, type: String(promotion_type).toUpperCase() },
      filters,
      price_policy
    });

    return res.json({ ok: true, job_id: jobId });
  } catch (e) {
    console.error('[/api/promocoes/bulk/prepare] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** Jobs – barra lateral de progresso (lista + detalhe + remover em massa) */
core.get('/api/promocoes/jobs', async (_req, res) => {
  try {
    // coleta das duas fontes já existentes
    const ours = PromoBulkRemove?.listRecent ? PromoBulkRemove.listRecent(25) : [];
    let bull = [];
    if (PromoJobsService?.listRecent) {
      try { bull = await PromoJobsService.listRecent(25); } catch (_) {}
    }

    // Normalizador super tolerante (cada fonte usa nomes diferentes)
    const norm = (j) => {
      if (!j) return null;
      const id = String(j.id || j.job_id || j._id || '');
      const state = String(j.state || j.status || j.phase || 'queued');

      // números
      const processed = Number(
        j.processed ?? j.done ?? j.success ?? j.stats?.processed ?? j.progress?.processed ?? 0
      ) || 0;
      const total = Number(
        j.total ?? j.expected_total ?? j.count ?? j.stats?.total ?? j.progress?.total ?? 0
      ) || 0;

      // progresso %  
      let progress = Number(
        j.progress?.percent ?? j.percent ?? j.percentage ?? j.stats?.percent ?? 0
      );
      if (!progress && total > 0) {
        progress = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
      }
      if (!Number.isFinite(progress)) progress = 0;

      // descrição amigável
      const label = j.title || j.name || j.description || '';
      const updated_at = j.updated_at || j.ts || Date.now();

      return { id, state, processed, total, progress, label, updated_at };
    };

    const merged = [...ours, ...bull]
      .map(norm)
      .filter(Boolean)
      // mais recentes primeiro
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

    // evita 304/ETag e força atualização no fetch
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    return res.json({ ok: true, jobs: merged });
  } catch (e) {
    console.error('[/api/promocoes/jobs] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

core.get('/api/promocoes/jobs/:job_id', async (req, res) => {
  try {
    const id = String(req.params.job_id || '');
    const j = PromoBulkRemove?.jobDetail ? PromoBulkRemove.jobDetail(id) : null;
    if (j) return res.json(j);

    if (PromoJobsService?.jobDetail) {
      const jb = await PromoJobsService.jobDetail(id);
      if (jb) return res.json(jb);
    }

    return res.status(404).json({ ok: false, error: 'job não encontrado' });
  } catch (e) {
    console.error('[/api/promocoes/jobs/:id] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Iniciar job de REMOÇÃO em massa (via seu service -> adapter)
core.post('/api/promocoes/jobs/remove', async (req, res) => {
  try {
    if (!PromoBulkRemove?.startRemoveJob) {
      return res.status(503).json({ ok: false, error: 'Adapter de remoção não configurado' });
    }
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const delay = Number(body.delay_ms ?? 250) || 0;

    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'Informe "items": [MLB...]' });
    }

    const job = await PromoBulkRemove.startRemoveJob({
      mlbIds: items,
      delayMs: delay,
      mlCreds: res.locals.mlCreds || {},
      accountKey: res.locals.accountKey || null,
      logger: console
    });

    return res.json({ ok: true, job_id: job.id, job });
  } catch (e) {
    console.error('[/api/promocoes/jobs/remove] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});


/**
 * Seleção robusta + tokenizada da campanha inteira
 * Body: { promotion_id, promotion_type, status, mlb, percent_max }
 *
 * Usada pelo botão "Selecionar toda a campanha (filtrados)" no front.
 */
/**
 * Prepara seleção global da campanha inteira, armazena os IDs em memória
 * e devolve um token para ser usado depois em /jobs/apply-mass.
 *
 * Body: {
 *   promotion_id,
 *   promotion_type,
 *   status,       // 'started' | 'candidate' | 'scheduled' | null
 *   mlb,          // opcional, string
 *   percent_max   // opcional, número (% desc. máx.)
 * }
 */

/**
 * Prepara seleção global (todas as páginas / filtrados) e devolve um token.
 * Body: { promotion_id, promotion_type, status, mlb, percent_max }
 */

/**
 * Prepara seleção global (conta todos os itens filtrados) e devolve um token.
 * Body: { promotion_id, promotion_type, status, mlb, percent_max }
 */
core.post('/api/promocoes/selection/prepare', async (req, res) => {
  try {
    const {
      promotion_id,
      promotion_type,
      status,        // 'started' | 'candidate' | 'scheduled' | null
      mlb,           // opcional, string MLB123...
      percent_max,   // opcional, número (desconto máx. %)
    } = req.body || {};

    if (!promotion_id || !promotion_type) {
      return res.status(400).json({
        ok: false,
        error: 'promotion_id e promotion_type são obrigatórios.',
      });
    }

    // credenciais e conta já estão em res.locals, igual nas outras rotas
    const creds = res.locals.mlCreds || {};
    const accountKey = String(res.locals.accountKey || 'default');

    // 🚫 ML não aceita limit >= 100 → usamos 50 (seguro)
    const ML_LIMIT = 50;

    let searchAfter = null;
    const ids = [];
    let page = 0;

    while (true) {
      page += 1;
      if (page > 500) break; // trava de segurança absurda

      const base = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(
        promotion_id
      )}/items`;

      const params = new URLSearchParams();
      params.set('promotion_type', String(promotion_type).toUpperCase());
      params.set('limit', String(ML_LIMIT));
      params.set('app_version', 'v2');

      if (status) params.set('status', String(status));
      if (searchAfter) params.set('search_after', String(searchAfter));
      if (mlb) params.set('q', String(mlb)); // filtro por MLB (quando suportado)

      const url = `${base}?${params.toString()}`;

      // usa o mesmo authFetch que o resto do arquivo (renova token se 401)
      const r = await authFetch(req, url, {}, creds);

      if (!r.ok) {
        // loga o corpo do erro do ML pra debug
        const txt = await r.text().catch(() => '');
        let ml_body;
        try {
          ml_body = txt ? JSON.parse(txt) : null;
        } catch {
          ml_body = { raw: txt };
        }

        console.error('Erro ao consultar itens da promoção no ML:', r.status, ml_body);

        return res.status(502).json({
          ok: false,
          error: 'Falha ao consultar itens da promoção no ML.',
          status: r.status,
          ml_body,
          url,
        });
      }

      const js = await r.json().catch(() => ({}));
      const results = Array.isArray(js.results) ? js.results : [];
      if (!results.length) break;

      // aplica filtro de desconto e MLB aqui mesmo (caso a API traga a mais)
      for (const it of results) {
        const id = String(it.id || it.item_id || '').trim();
        if (!id) continue;

        // filtro de desconto máx. (%)
        if (
          percent_max != null &&
          percent_max !== '' &&
          Number.isFinite(Number(percent_max))
        ) {
          const pct = Number(it.discount_percentage || 0);
          if (pct > Number(percent_max)) continue;
        }

        // filtro extra por MLB (garantia)
        if (mlb && id !== mlb) continue;

        ids.push(id);
      }

      // paginação: tenta pegar qualquer campo que o ML mande
      const paging = js.paging || {};
      searchAfter =
        paging.search_after ||
        paging.searchAfter ||
        paging.next_token ||
        null;

      if (!searchAfter) break;
    }

    // Se não tiver store avançada, devolve só a lista/contagem (fallback)
    if (!PromoSelectionStore || typeof PromoSelectionStore.saveSelection !== 'function') {
      return res.json({
        ok: true,
        token: null,
        total: ids.length,
        meta: {
          accountKey,
          promotionId: promotion_id,
          promotionType: promotion_type,
          filters: {
            status: status || null,
            mlb: mlb || null,
            percent_max:
              percent_max == null || percent_max === ''
                ? null
                : Number(percent_max),
          },
        },
        ids, // opcional: lista inteira já pronta
      });
    }

    // Versão com store/token (para usar depois em /jobs/apply-mass)
    const { token, total, meta } = await PromoSelectionStore.saveSelection({
      accountKey,
      userId: req.user?.id || null,
      promotionId: promotion_id,
      promotionType: promotion_type,
      filters: {
        status: status || null,
        mlb: mlb || null,
        percent_max:
          percent_max == null || percent_max === ''
            ? null
            : Number(percent_max),
      },
      ids,
      meta: {
        createdAt: Date.now(),
      },
    });

    return res.json({
      ok: true,
      token,
      total,
      meta,
    });
  } catch (e) {
    console.error('Erro em /api/promocoes/selection/prepare:', e);
    return res.status(500).json({
      ok: false,
      error: 'Erro interno ao preparar seleção.',
    });
  }
});









/**
 * Dispara job em massa (apply/remove) a partir do token da seleção preparada.
 * Body: { token, action: "apply"|"remove", values?: { dryRun?: boolean } }
 */
core.post('/api/promocoes/jobs/apply-mass', async (req, res) => {
  try {
    if (!PromoJobsService || typeof PromoJobsService.enqueueBulkApply !== 'function') {
      return res.status(503).json({ ok: false, error: 'PromoJobsService indisponível.' });
    }
    if (!PromoSelectionStore || typeof PromoSelectionStore.getSelection !== 'function') {
      return res.status(503).json({ ok: false, error: 'PromoSelectionStore indisponível.' });
    }

    const { token, action = 'apply', values = {} } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: 'token é obrigatório.' });
    }

    const accountKey = String(res.locals.accountKey || 'default');
    const selection = PromoSelectionStore.getSelection(token, { accountKey });

    if (!selection) {
      return res.status(404).json({ ok: false, error: 'Seleção não encontrada ou expirada.' });
    }

    const creds = res.locals.mlCreds || {};
    const promotionId = selection.promotionId;
    const promotionType = selection.promotionType;
    const fSel = selection.filters || {};

    // adapta filtros para o formato do PromoJobsService
    const filters = {
      status: fSel.status || null,
      maxDesc: fSel.percent_max != null ? Number(fSel.percent_max) : null,
      mlb: fSel.mlb || null,
    };

    const options = {
      dryRun: !!values.dryRun,
      expected_total: Array.isArray(selection.items) ? selection.items.length : 0,
    };

    PromoJobsService.init?.();

    const jobId = await PromoJobsService.enqueueBulkApply({
      mlCreds: creds,
      accountKey,
      action,
      promotion: { id: String(promotionId), type: String(promotionType).toUpperCase() },
      filters,
      price_policy: 'min',
      options,
    });

    // renova TTL da seleção enquanto o job é criado
    PromoSelectionStore.touch?.(token);

    return res.json({ ok: true, job_id: jobId });
  } catch (e) {
    console.error('[/api/promocoes/jobs/apply-mass] erro:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});



// ---- Montagem do router com aliases funcionais (shim)
const router = express.Router();

// Mantém as rotas com prefixo já definido dentro do "core"
router.use(core);

// Aliases: reescrevem a URL antes de cair no "core" para apontar para /api/promocoes/*
router.use('/api/promocao', (req, _res, next) => {
  req.url = '/api/promocoes' + req.url; // ex.: "/users" -> "/api/promocoes/users"
  next();
}, core);

router.use('/api/promotions', (req, _res, next) => {
  req.url = '/api/promocoes' + req.url;
  next();
}, core);

module.exports = router;
