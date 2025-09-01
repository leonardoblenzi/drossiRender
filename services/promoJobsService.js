// services/promoJobsService.js
/**
 * PromoJobsService
 * - Fila Bull baseada em Redis para aplicar promoções em MASSA
 * - Varre a campanha inteira respeitando filtros (status / % máx / MLB)
 * - Chama a mesma API oficial do ML que você usa hoje
 *
 * Requer: REDIS_URL ou REDIS_HOST/REDIS_PORT
 */

const Queue = require('bull');
const fetch = require('node-fetch');
const TokenService = require('./tokenService');

const REDIS_OPTS = process.env.REDIS_URL
  ? { redis: process.env.REDIS_URL }
  : {
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined
      }
    };
// === Adapter opcional para remoção em massa (reutiliza seu service atual)
let RemovalAdapter = null;
try {
  // Troque o caminho dentro do adapter NOVO (promoBulkRemoveAdapter.js) para apontar ao seu service
  RemovalAdapter = require('./promoBulkRemoveAdapter');
} catch {
  RemovalAdapter = null; // se não existir, o job de remoção avisará "não configurado"
}

let queue;

/* ----------------------- Helpers HTTP com renovação ----------------------- */

async function authFetch(url, init = {}, mlCreds = {}) {
  const call = async (tkn) => {
    const headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${tkn}`,
      Accept: 'application/json'
    };
    return fetch(url, { ...init, headers });
  };

  // 1ª tentativa com access_token atual (pode vir no mlCreds)
  let token = mlCreds?.access_token || null;
  if (!token) {
    // pega/renova se necessário
    const renewed = await TokenService.renovarTokenSeNecessario(mlCreds);
    token = renewed?.access_token || mlCreds?.access_token;
  }

  let resp = await call(token);
  if (resp.status !== 401) return resp; // ok (ou outro erro que não seja 401)

  // 401 -> renova e tenta de novo
  const renewed = await TokenService.renovarToken(mlCreds);
  const newToken = renewed?.access_token;
  return call(newToken);
}

const toNum = (v) =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v))
    ? null
    : Number(v);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* ----------------------------- Busca paginada ----------------------------- */

async function fetchPromotionItemsPaged({
  mlCreds,
  promotion_id,
  promotion_type,
  status,           // 'started' | 'candidate' | undefined
  limit = 50,
  search_after = null
}) {
  const qs = new URLSearchParams();
  qs.set('promotion_type', String(promotion_type));
  if (status) qs.set('status', String(status));
  qs.set('limit', String(limit));
  if (search_after) qs.set('search_after', String(search_after));
  qs.set('app_version', 'v2');

  const url = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(
    promotion_id
  )}/items?${qs.toString()}`;

  const r = await authFetch(url, {}, mlCreds);
  const txt = await r.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    json = {};
  }
  const results = Array.isArray(json.results) ? json.results : [];
  const next = json?.paging?.searchAfter || null;
  const total = json?.paging?.total ?? null;
  const benefits = json?.promotion_benefits || null;

  return { results, next, total, benefits, status: r.status };
}

/** Para SMART/PRICE_MATCHING: achar o offer_id candidate do item naquela campanha */
async function getOfferIdForItem({ mlCreds, item_id, promotion_id }) {
  const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(
    item_id
  )}?app_version=v2`;
  const r = await authFetch(url, {}, mlCreds);
  if (!r.ok) return null;
  let arr;
  try {
    arr = await r.json();
  } catch {
    arr = [];
  }
  const list = Array.isArray(arr) ? arr : Array.isArray(arr.results) ? arr.results : [];
  const hit = list.find((p) => String(p.id || p.promotion_id) === String(promotion_id));
  const offer = hit?.offers?.[0] || null;
  return offer?.id || hit?.offer_id || null;
}

/* --------------- Calcula novo preço para DEAL/SELLER_CAMPAIGN ------------- */
function resolveDealPriceForDealItem(item, policy = 'min') {
  // Campos que o ML devolve para DEAL:
  // original_price, min_discounted_price, suggested_discounted_price, max_discounted_price, price (quando started)
  const original = toNum(item.original_price ?? item.price ?? null);

  let candidate;
  if (policy === 'suggested') {
    candidate =
      toNum(item.suggested_discounted_price) ??
      toNum(item.min_discounted_price) ??
      toNum(item.price ?? null);
  } else if (policy === 'max') {
    candidate =
      toNum(item.max_discounted_price) ??
      toNum(item.suggested_discounted_price) ??
      toNum(item.min_discounted_price) ??
      toNum(item.price ?? null);
  } else {
    // default: mínimo permitido
    candidate =
      toNum(item.min_discounted_price) ??
      toNum(item.suggested_discounted_price) ??
      toNum(item.price ?? null);
  }

  if (candidate == null || original == null) return { newPrice: null, discountPct: null };

  const pct = 100 * (1 - candidate / original);
  return { newPrice: round2(candidate), discountPct: pct };
}

/* ----------------------------- Aplicar o item ----------------------------- */

async function applyItem({ mlCreds, promotion_id, promotion_type, item, policy = 'min' }) {
  const t = String(promotion_type || '').toUpperCase();
  const item_id = item.id || item.item_id;

  const payload = { promotion_id, promotion_type: t };
  if (t === 'SMART' || t.startsWith('PRICE_MATCHING')) {
    // precisa de offer_id
    const offerId = item.offer_id || (item.offers && item.offers[0]?.id) ||
      (await getOfferIdForItem({ mlCreds, item_id, promotion_id }));
    if (!offerId) {
      return { ok: false, status: 400, error: 'offer_id não encontrado' };
    }
    payload.offer_id = offerId;
  } else if (t === 'SELLER_CAMPAIGN' || t === 'DEAL') {
    const { newPrice } = resolveDealPriceForDealItem(item, policy);
    if (newPrice == null) {
      return { ok: false, status: 400, error: 'Não foi possível calcular deal_price' };
    }
    payload.deal_price = newPrice;
  } else if (t === 'MARKETPLACE_CAMPAIGN') {
    // nada extra
  }

  const url = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(
    item_id
  )}?app_version=v2`;
  const r = await authFetch(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    mlCreds
  );

  let json;
  const txt = await r.text().catch(() => '');
  try {
    json = JSON.parse(txt);
  } catch {
    json = { raw: txt };
  }
  return { ok: r.ok, status: r.status, body: json };
}

// Remove 1 item usando o adapter (que chama seu service)
async function removeItem({ mlCreds, promotion_id, promotion_type, item }) {
  if (!RemovalAdapter || typeof RemovalAdapter.removeOne !== 'function') {
    return { ok: false, status: 501, error: 'Bulk removal adapter não configurado' };
  }
  const item_id = item.id || item.item_id;
  try {
    const r = await RemovalAdapter.removeOne({ mlCreds, promotion_id, promotion_type, item_id });
    // Normalize resultado
    return {
      ok: !!r?.ok,
      status: r?.status ?? (r?.ok ? 200 : 400),
      body: r?.body ?? r ?? null
    };
  } catch (e) {
    return { ok: false, status: 500, error: e.message || String(e) };
  }
}



/* -------------------------- Execução do job (worker) ---------------------- */

async function runBulkJob(job, done) {
  const data = job.data || {};
  const {
    mlCreds,                 // credenciais completas (para renovar token)
    accountKey,              // label da conta (log)
    action,                  // 'apply' | 'remove' (remove ainda não)
    promotion: { id: promotion_id, type: promotion_type },
    filters = {},            // { status: 'all'|'started'|'candidate', maxDesc: number|null, mlb: string|null }
    price_policy = 'min'     // 'min' | 'suggested' | 'max'
  } = data;

  job.progress(0);

  const wantStatus =
    filters.status === 'started' || filters.status === 'candidate'
      ? filters.status
      : undefined;

  let total = 0;
  let processed = 0;
  let success = 0;
  let failed = 0;

  let token = null;
  let benefitsGlobal = null;

  // 1º “passo”: varrer tudo e aplicar os filtros
  while (true) {
    const page = await fetchPromotionItemsPaged({
      mlCreds,
      promotion_id,
      promotion_type,
      status: wantStatus,
      limit: 50,
      search_after: token
    });

    if (!benefitsGlobal && page.benefits) benefitsGlobal = page.benefits;

    const items = page.results || [];
    if (!items.length && !page.next) break;

    for (const it of items) {
      const id = (it.id || it.item_id || '').toUpperCase();
      if (filters.mlb && id !== String(filters.mlb).toUpperCase()) continue;

      // filtrar por % máx (se informado)
      if (filters.maxDesc != null) {
        let pct = toNum(it.discount_percentage);
        // DEAL candidate normalmente não vem com discount_percentage -> calcula com "min" (ou policy)
        if (pct == null && (promotion_type === 'DEAL' || promotion_type === 'SELLER_CAMPAIGN')) {
          const { newPrice, discountPct } = resolveDealPriceForDealItem(it, price_policy);
          pct = discountPct;
          if (newPrice != null) {
            // já guardamos no item para evitar recomputar depois
            it.deal_price = newPrice;
          }
        }
        if (pct == null) {
          // SMART: tenta somar meli+seller se vierem
          const meli =
            toNum(it.meli_percentage) ??
            toNum(it.rebate_meli_percent) ??
            toNum(benefitsGlobal?.meli_percent);
          const seller =
            toNum(it.seller_percentage) ??
            toNum(benefitsGlobal?.seller_percent);
          const totalPct = toNum((meli || 0) + (seller || 0));
          pct = totalPct != null ? totalPct : null;
        }
        if (pct == null || pct > Number(filters.maxDesc)) {
          continue;
        }
      }

      // 2º passo: executar ação
      total++;
      if (action === 'apply') {
        const res = await applyItem({
          mlCreds,
          promotion_id,
          promotion_type,
          item: it,
          policy: price_policy
        });
        processed++;
        if (res.ok) success++;
        else failed++;
        job.progress(Math.round((processed / Math.max(total, 1)) * 100));
       } else if (action === 'remove') {
            const res = await removeItem({
                mlCreds,
                promotion_id,
                promotion_type,
                item: it
            });
            processed++;
            if (res.ok) success++;
            else failed++;
            job.progress(Math.round((processed / Math.max(total, 1)) * 100));
}

    }

    if (!page.next) break;
    token = page.next;
  }

  const summary = {
    id: job.id,
    title: `Aplicar ${promotion_type} ${promotion_id}`,
    status: 'completed',
    total,
    processed,
    success,
    failed,
    finished_at: new Date().toISOString()
  };

  done(null, summary);
}

/* ------------------------------ API do serviço ---------------------------- */

module.exports = {
  init() {
    if (queue) return queue;

    queue = new Queue('promo-jobs', REDIS_OPTS);

    queue.process(runBulkJob);

    queue.on('error', (e) => console.error('PromoJobsService Queue error:', e.message));
    queue.on('failed', (job, err) => {
      console.error('PromoJobsService Job failed:', job?.id, err?.message);
    });
    queue.on('completed', (job, result) => {
      // noop – já retornamos summary
    });

    console.log('⚙️  PromoJobsService inicializado (Bull)');
    return queue;
  },

  /**
   * Cria job de aplicação em massa.
   * @param {object} opts
   *  - mlCreds, accountKey
   *  - promotion {id, type}
   *  - filters {status, maxDesc, mlb}
   *  - price_policy 'min' | 'suggested' | 'max'
   *  - action 'apply' | 'remove'
   */
  async enqueueBulkApply(opts) {
    if (!queue) this.init();
    const job = await queue.add(
      { ...opts, action: opts.action || 'apply' },
      { removeOnComplete: true, removeOnFail: false }
    );
    return job?.id;
  },

  // usados pela UI direita
  async listRecent(n = 10) {
    if (!queue) this.init();
    const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'], 0, n - 1, false);
    const map = await Promise.all(
      jobs.map(async (j) => {
        const s = await j.getState();
        const r = await j.finished().catch(() => null);
        const pct = j.progress() || 0;
        return {
          id: j.id,
          title: j.data?.promotion?.id
            ? `Aplicando ${j.data.promotion.type} ${j.data.promotion.id}`
            : 'Job de promoção',
          state: s,
          progress: pct,
          result: r || null,
          created_at: new Date(j.timestamp).toISOString(),
          updated_at: new Date(j.processedOn || j.timestamp).toISOString()
        };
      })
    );
    return map;
  },

  async jobDetail(job_id) {
    if (!queue) this.init();
    const j = await queue.getJob(job_id);
    if (!j) return null;
    const s = await j.getState();
    const r = await j.finished().catch(() => null);
    return {
      id: j.id,
      state: s,
      progress: j.progress() || 0,
      data: j.data,
      result: r
    };
  }
};
