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
    if (results.length === 0) {
      // Normaliza paging
      const p = promoJson.paging || {};
      return res.json({
        ...promoJson,
        paging: {
          ...p,
          searchAfter: p.searchAfter ?? p.next_token ?? p.search_after ?? null
        }
      });
    }

    const ids = results.map(r => r.id || r.item_id).filter(Boolean);
    const packs = chunk(ids, 20);
    const details = {};

    for (const pack of packs) {
      const urlItems = `https://api.mercadolibre.com/items?ids=${encodeURIComponent(pack.join(','))}&attributes=${encodeURIComponent('id,title,available_quantity,seller_custom_field,price')}`;
      const ir = await authFetch(req, urlItems, {}, creds);
      if (!ir.ok) {
        const txt = await ir.text().catch(() => '');
        console.warn('[promocoesRoutes] enrich items erro:', ir.status, txt);
        continue;
      }
      const blob = await ir.json().catch(() => []);
      (Array.isArray(blob) ? blob : []).forEach((row) => {
        const b = row?.body || row || {};
        if (b?.id) {
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
      const id = r.id || r.item_id;
      const d = details[id] || {};
      const original = r.original_price ?? d.price ?? null;
      const deal = r.price ?? r.deal_price ?? null;
      let discount = r.discount_percentage;
      if ((discount == null) && original && deal && Number(original) > 0) {
        discount = (1 - (Number(deal) / Number(original))) * 100;
      }
      return {
        ...r, // mantém offer_id, status etc.
        id,
        title: d.title,
        available_quantity: d.available_quantity,
        seller_custom_field: d.seller_custom_field,
        original_price: original,
        deal_price: deal,
        discount_percentage: discount,
      };
    });

    const p = promoJson.paging || {};
    return res.json({
      ...promoJson,
      results: merged,
      paging: {
        ...p,
        searchAfter: p.searchAfter ?? p.next_token ?? p.search_after ?? null
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
 *   "options": { "dryRun": false }
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
    const ours = PromoBulkRemove?.listRecent ? PromoBulkRemove.listRecent(15) : [];
    let bull = [];
    if (PromoJobsService?.listRecent) {
      try { bull = await PromoJobsService.listRecent(15); } catch {}
    }

    // evita 304/ETag e força atualização no fetch
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    return res.json({ jobs: [...ours, ...bull] });
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
 * Prepara seleção global (conta quantos itens a partir dos filtros) e devolve token.
 * Body: { promotion_id, promotion_type, status, percent_min, percent_max }
 */
core.post('/api/promocoes/selection/prepare', async (req, res) => {
  try {
    if (!PromoSelectionStore?.saveSelection) {
      return res.status(503).json({ ok: false, error: 'PromoSelectionStore indisponível' });
    }
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

    for (let guard=0; guard<500; guard++) { // máx ~25k itens
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
      const paging = j?.paging || {};
      next = paging.searchAfter ?? paging.next_token ?? paging.search_after ?? null;
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
    if (!PromoJobsService?.enqueueApplyMass) {
      return res.status(503).json({ ok:false, error:'PromoJobsService indisponível' });
    }
    const accountKey = String(res.locals.accountKey || 'default');
    const { token, action, values } = req.body || {};
    if (!token || !action) return res.status(400).json({ ok:false, error:'token e action são obrigatórios' });

    const meta = await PromoSelectionStore?.getMeta?.(token);
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
