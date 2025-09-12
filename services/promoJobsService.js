// services/promoJobsService.js
/**
 * PromoJobsService
 * - Fila Bull baseada em Redis para aplicar promoções em MASSA
 * - Varrimento com filtros (status / % máx / MLB)
 * - Chama a API oficial do ML
 *
 * Requer: REDIS_URL ou REDIS_HOST/REDIS_PORT
 */

const Queue = require('bull');
const fetch = require('node-fetch');
const TokenService = require('./tokenService');

// Concurrency do worker (ajustável por env)
const CONCURRENCY = Number(process.env.PROMO_JOBS_CONCURRENCY || 4);

// Config Redis: aceita string REDIS_URL OU objeto { redis: { host, port, password } }
const REDIS_OPTS =
  process.env.REDIS_URL
    ? process.env.REDIS_URL // Bull aceita a URL diretamente
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
// services/promoJobsService.js
function computeDiscountPct(it, promotion_type, benefitsGlobal, price_policy) {
  const t = String(promotion_type).toUpperCase();
  const n = (v) => (v==null || Number.isNaN(Number(v)) ? null : Number(v));

  // já veio pronto?
  let pct = n(it.discount_percentage);
  if (pct != null) return pct;

  if (t === 'DEAL' || t === 'SELLER_CAMPAIGN' || t === 'PRICE_DISCOUNT' || t === 'DOD') {
    const orig = n(it.original_price ?? it.price);
    let deal  = n(it.deal_price ?? it.price);
    if (deal == null) {
      const r = resolveDealPriceForDealItem(it, price_policy);
      if (r.newPrice != null) {
        it.deal_price = r.newPrice; // cache para não recalcular depois
        deal = r.newPrice;
      }
    }
    if (orig != null && deal != null && orig > 0) return 100 * (1 - deal / orig);
    return null;
  }

  if (t === 'SMART' || t.startsWith('PRICE_MATCHING')) {
    const meli   = n(it.meli_percentage ?? it.rebate_meli_percent ?? benefitsGlobal?.meli_percent);
    const seller = n(it.seller_percentage ?? benefitsGlobal?.seller_percent);
    const tot = n((meli || 0) + (seller || 0));
    return tot;
  }

  return n(it.discount_percentage);
}

function isEligible(it, { mlb, maxDesc }, promotion_type, benefitsGlobal, price_policy) {
  if (mlb && String(it.id || it.item_id).toUpperCase() !== String(mlb).toUpperCase()) return false;
  if (maxDesc != null) {
    const pct = computeDiscountPct(it, promotion_type, benefitsGlobal, price_policy);
    if (pct == null || pct > Number(maxDesc)) return false;
  }
  return true;
}

async function precountEligible({ mlCreds, promotion_id, promotion_type, status, filters, price_policy }) {
  let token = null;
  let total = 0;
  let benefitsGlobal = null;

  while (true) {
    const page = await fetchPromotionItemsPaged({
      mlCreds, promotion_id, promotion_type, status, limit: 50, search_after: token
    });

    if (!benefitsGlobal && page.benefits) benefitsGlobal = page.benefits;

    const items = page.results || [];
    for (const it of items) {
      if (isEligible(it, filters, promotion_type, benefitsGlobal, price_policy)) total++;
    }

    if (!page.next || items.length === 0) break;
    token = page.next;
  }

  return { total, benefitsGlobal };
}



// --- helpers comuns ---
const extractAccessToken = (ret) =>
  (typeof ret === 'string' ? ret : ret?.access_token || null);

// substitua seu authFetch por este (usa o helper)
async function authFetch(url, init = {}, mlCreds = {}) {
  const call = async (tkn) => {
    const headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${tkn}`,
      Accept: 'application/json'
    };
    return fetch(url, { ...init, headers });
  };

  let token = mlCreds?.access_token || null;
  if (!token) {
    const t = await TokenService.renovarTokenSeNecessario(mlCreds);
    token = extractAccessToken(t);
  }

  let resp = await call(token);
  if (resp.status !== 401) return resp;

  const renewed = await TokenService.renovarToken(mlCreds);
  const newToken = extractAccessToken(renewed);
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
  qs.set('promotion_type', String(promotion_type).toUpperCase());
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
  const p = json?.paging || {};
  const next = p.searchAfter ?? p.next_token ?? p.search_after ?? null;
  const total = p.total ?? null;
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

async function applyItem({ mlCreds, promotion_id, promotion_type, item, policy = 'min', dryRun = false }) {
  const t = String(promotion_type || '').toUpperCase();
  if (t === 'PRICE_MATCHING_MELI_ALL') {
    return { ok: false, status: 501, error: 'PRICE_MATCHING_MELI_ALL é 100% ML (aplicação manual indisponível)' };
  }

  const item_id = item.id || item.item_id;

  const payload = { promotion_id, promotion_type: t };
  if (t === 'SMART' || t.startsWith('PRICE_MATCHING')) {
    // precisa de offer_id
    const offerId =
      item.offer_id ||
      (item.offers && item.offers[0]?.id) ||
      (await getOfferIdForItem({ mlCreds, item_id, promotion_id }));
    if (!offerId) {
      return { ok: false, status: 400, error: 'offer_id não encontrado' };
    }
    payload.offer_id = offerId;
  } else if (t === 'SELLER_CAMPAIGN' || t === 'DEAL') {
    // usa preço calculado (guardamos no item se já existir)
    const dealAlready = toNum(item.deal_price);
    const { newPrice } = dealAlready != null
      ? { newPrice: dealAlready }
      : resolveDealPriceForDealItem(item, policy);

    if (newPrice == null) {
      return { ok: false, status: 400, error: 'Não foi possível calcular deal_price' };
    }
    payload.deal_price = newPrice;
  } else if (t === 'MARKETPLACE_CAMPAIGN') {
    // nada extra
  }

  if (dryRun) {
    // Simula sucesso sem bater no ML
    return { ok: true, status: 200, body: { dryRun: true, payload } };
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
    mlCreds,
    accountKey,
    action,
    promotion: { id: promotion_id, type: promotion_type_raw } = { id: null, type: null },
    filters = {},
    price_policy = 'min',
    options = {}
  } = data;

  const promotion_type = String(promotion_type_raw || '').toUpperCase();
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

  // varrer todas as páginas aplicando filtros
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

      // filtra por % máx, calculando quando necessário
      if (filters.maxDesc != null) {
        let pct = toNum(it.discount_percentage);

        if (pct == null && (promotion_type === 'DEAL' || promotion_type === 'SELLER_CAMPAIGN')) {
          const dealAlready = toNum(it.deal_price);
          let discountPct;
          if (dealAlready != null && toNum(it.original_price ?? it.price) != null) {
            const original = toNum(it.original_price ?? it.price);
            discountPct = 100 * (1 - dealAlready / original);
          } else {
            const res = resolveDealPriceForDealItem(it, price_policy);
            if (res.newPrice != null) it.deal_price = res.newPrice;
            discountPct = res.discountPct;
          }
          pct = discountPct;
        }

        if (pct == null && (promotion_type === 'SMART' || promotion_type.startsWith('PRICE_MATCHING'))) {
          const meli   = toNum(it.meli_percentage) ?? toNum(it.rebate_meli_percent) ?? toNum(benefitsGlobal?.meli_percent);
          const seller = toNum(it.seller_percentage) ?? toNum(benefitsGlobal?.seller_percent);
          const totalPct = toNum((meli || 0) + (seller || 0));
          pct = totalPct != null ? totalPct : null;
        }

        if (pct == null || pct > Number(filters.maxDesc)) {
          continue;
        }
      }

      // conta item que será processado
      total++;

      try {
        if (action === 'apply') {
          const res = await applyItem({
            mlCreds,
            promotion_id,
            promotion_type,
            item: it,
            policy: price_policy,
            dryRun: !!options.dryRun
          });
          processed++;
          if (res.ok) success++; else failed++;
        } else if (action === 'remove') {
          const res = await removeItem({
            mlCreds,
            promotion_id,
            promotion_type,
            item: it
          });
          processed++;
          if (res.ok) success++; else failed++;
        } else {
          processed++; failed++;
        }
      } catch {
        processed++; failed++;
      }

      // atualiza progresso + counters visíveis para o painel
      const pct = Math.round((processed / Math.max(total, 1)) * 100);
      job.progress(pct);
      try {
        await job.update({
          ...job.data,
          counters: { processed, total },
          stateLabel: `processando ${processed}/${total}`
        });
      } catch (_) { /* silencioso */ }
    }

    if (!page.next) break;
    token = page.next;
  }

  const summary = {
    id: job.id,
    title: `${action === 'remove' ? 'Remover' : 'Aplicar'} ${promotion_type} ${promotion_id}`,
    status: 'completed',
    total,
    processed,
    success,
    failed,
    finished_at: new Date().toISOString()
  };

  // grava rótulo final (aproveitado pela listagem)
  try {
    await job.update({
      ...job.data,
      counters: { processed, total },
      stateLabel: `concluído: ${success} ok, ${failed} erros`
    });
  } catch (_) {}

  done(null, summary);
}



/* ------------------------------ API do serviço ---------------------------- */

module.exports = {
  init() {
    if (queue) return queue;

    queue = new Queue('promo-jobs', REDIS_OPTS);

    // Concurrency controlado
    queue.process(CONCURRENCY, runBulkJob);

    queue.on('error', (e) => console.error('PromoJobsService Queue error:', e.message));
    queue.on('failed', (job, err) => {
      console.error('PromoJobsService Job failed:', job?.id, err?.message);
    });
    queue.on('completed', () => {
      // noop – o summary é retornado pelo worker
    });

    console.log(`⚙️  PromoJobsService inicializado (Bull) — concurrency=${CONCURRENCY}`);
    return queue;
  },

  /**
   * Cria job de aplicação/remoção em massa.
   * @param {object} opts
   *  - mlCreds, accountKey
   *  - promotion {id, type}
   *  - filters {status, maxDesc, mlb}
   *  - price_policy 'min' | 'suggested' | 'max'
   *  - action 'apply' | 'remove'
   *  - options { dryRun?: boolean }
   */
  async enqueueBulkApply(opts) {
    if (!queue) this.init();
    const data = {
      ...opts,
      action: opts.action || 'apply',
      // normaliza tipo aqui por segurança
      promotion: {
        id: String(opts?.promotion?.id || ''),
        type: String(opts?.promotion?.type || '').toUpperCase()
      }
    };
    const job = await queue.add(
      data,
      {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1 // pode ajustar/backoff conforme necessidade
      }
    );
    return job?.id;
  },

  // usados pela UI direita
 


  // SUBSTITUA listRecent por este:
async listRecent(n = 10) {
  if (!queue) this.init();
  const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'], 0, n - 1, false);

  const map = await Promise.all(
    jobs.map(async (j) => {
      const state = await j.getState().catch(() => 'unknown');
      const pct   = Number(j.progress() || 0);
      const d     = j.data || {};

      // título padrão
      const title = d?.promotion?.id
        ? `${d.action === 'remove' ? 'Removendo' : 'Aplicando'} ${d.promotion.type} ${d.promotion.id}`
        : 'Job de promoção';

      // se o worker atualizou counters/stateLabel, usa "processando 4/xx"
      const counters = d.counters || {};
      let stateLabel = d.stateLabel || state;
      if (state === 'active' && (counters.processed != null || counters.total != null)) {
        stateLabel = `processando ${counters.processed ?? 0}/${counters.total ?? '?'}`;
      }

      // resultado só quando concluído
      const result = state === 'completed' ? (j.returnvalue || null) : null;

      return {
        id: j.id,
        title,
        state: stateLabel,
        progress: pct,
        result,
        created_at: new Date(j.timestamp).toISOString(),
        updated_at: new Date(j.processedOn || j.timestamp).toISOString()
      };
    })
  );
  return map;
},

// SUBSTITUA jobDetail por este:
async jobDetail(job_id) {
  if (!queue) this.init();
  const j = await queue.getJob(job_id);
  if (!j) return null;

  const state = await j.getState().catch(() => 'unknown');
  const d     = j.data || {};
  const counters = d.counters || {};

  return {
    id: j.id,
    state: d.stateLabel || state,
    progress: Number(j.progress() || 0),
    data: {
      ...d,
      counters
    },
    result: state === 'completed' ? (j.returnvalue || null) : null
  };
}

};
