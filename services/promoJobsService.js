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

/* ------------------------- Helpers genéricos ------------------------- */

const extractAccessToken = (ret) =>
  (typeof ret === 'string' ? ret : ret?.access_token || null);

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

function clampPct(n){
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/* -------------------- Normalização de status p/ ML ------------------- */

function normalizeStatusForML(s) {
  if (!s) return '';
  const v = String(s).toLowerCase().trim();
  if (v === 'pending') return 'scheduled';
  if (v === 'prog' || v === 'programados' || v === 'programado') return 'scheduled';
  if (v === 'yes' || v === 'participantes') return 'started';
  if (v === 'non' || v === 'nao' || v === 'não') return 'candidate';
  return v; // 'candidate' | 'started' | 'scheduled' | 'all'
}
function statusQueryOrNull(s) {
  const v = normalizeStatusForML(s);
  return (!v || v === 'all') ? null : v;
}

/* ----------------------------- Busca paginada ----------------------------- */

async function fetchPromotionItemsPaged({
  mlCreds,
  promotion_id,
  promotion_type,
  status,           // 'started' | 'candidate' | 'scheduled' | null
  limit = 50,
  search_after = null
}) {
  const qs = new URLSearchParams();
  qs.set('promotion_type', String(promotion_type).toUpperCase());
  const s = statusQueryOrNull(status);
  if (s) qs.set('status', String(s));
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

/* ----------------- Cálculo de % de desconto e filtros ----------------- */

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

/* -------------------------- Pré-contagem (estável) -------------------------- */

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
  
  // ✅ VALIDAÇÃO CRÍTICA: Se promotion_id está vazio/inválido, cancelar job imediatamente
  if (!promotion_id || promotion_id === 'undefined' || promotion_id === 'null' || promotion_id === '') {
    console.error(`[PromoJobsService] Job ${job.id} - promotion_id inválido: "${promotion_id}". Cancelando job.`);
    
    const errorData = {
      ...job.data,
      counters: { processed: 0, total: 0, success: 0, failed: 0 },
      stateLabel: 'erro: promotion_id inválido',
      lastUpdate: Date.now()
    };
    
    try {
      await job.update(errorData);
      await job.progress(100);
    } catch (e) {
      console.error(`[PromoJobsService] Job ${job.id} - Erro ao atualizar job com erro:`, e.message);
    }
    
    return done(new Error('promotion_id inválido'), null);
  }

  // ✅ VALIDAÇÃO: Se não há credenciais ML, cancelar
  if (!mlCreds || !mlCreds.access_token) {
    console.error(`[PromoJobsService] Job ${job.id} - Credenciais ML ausentes. Cancelando job.`);
    
    const errorData = {
      ...job.data,
      counters: { processed: 0, total: 0, success: 0, failed: 0 },
      stateLabel: 'erro: credenciais ML ausentes',
      lastUpdate: Date.now()
    };
    
    try {
      await job.update(errorData);
      await job.progress(100);
    } catch (e) {
      console.error(`[PromoJobsService] Job ${job.id} - Erro ao atualizar job com erro:`, e.message);
    }
    
    return done(new Error('Credenciais ML ausentes'), null);
  }
  
  // Inicializar progresso imediatamente
  await job.progress(0);

  const wantStatus = statusQueryOrNull(filters.status) || undefined;

  // Counters
  let total = 0;
  let processed = 0;
  let success = 0;
  let failed = 0;

  // Definir total ANTES e atualizar job imediatamente
  let benefitsGlobal = null;
  try {
    console.log(`[PromoJobsService] Job ${job.id} - Calculando total para promotion_id: ${promotion_id}...`);
    
    if (typeof options.expected_total === 'number' && options.expected_total > 0) {
      total = Number(options.expected_total);
      console.log(`[PromoJobsService] Job ${job.id} - Total esperado: ${total}`);
    } else {
      const pre = await precountEligible({
        mlCreds,
        promotion_id,
        promotion_type,
        status: wantStatus,
        filters,
        price_policy
      });
      total = Number(pre.total || 0);
      benefitsGlobal = pre.benefitsGlobal || null;
      console.log(`[PromoJobsService] Job ${job.id} - Total calculado: ${total}`);
    }
  } catch (e) {
    console.error(`[PromoJobsService] Job ${job.id} - Erro ao calcular total:`, e.message);
    total = 0;
  }

  // ✅ VALIDAÇÃO: Se total é 0, finalizar job imediatamente
  if (total === 0) {
    console.log(`[PromoJobsService] Job ${job.id} - Nenhum item encontrado para processar. Finalizando job.`);
    
    const emptyData = {
      ...job.data,
      counters: { processed: 0, total: 0, success: 0, failed: 0 },
      stateLabel: 'concluído: nenhum item encontrado',
      lastUpdate: Date.now()
    };
    
    try {
      await job.update(emptyData);
      await job.progress(100);
    } catch (e) {
      console.error(`[PromoJobsService] Job ${job.id} - Erro ao finalizar job vazio:`, e.message);
    }
    
    const summary = {
      id: job.id,
      title: `${action === 'remove' ? 'Remover' : 'Aplicar'} ${promotion_type} ${promotion_id}`,
      status: 'completed',
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      finished_at: new Date().toISOString(),
      message: 'Nenhum item encontrado para processar'
    };
    
    return done(null, summary);
  }

  // Atualizar job data com total definido IMEDIATAMENTE
  const initialData = {
    ...job.data,
    counters: { processed, total, success, failed },
    stateLabel: total > 0 ? `iniciando 0/${total}` : `iniciando 0/?`,
    lastUpdate: Date.now()
  };

  try {
    await job.update(initialData);
    console.log(`[PromoJobsService] Job ${job.id} - Dados iniciais atualizados`);
  } catch (e) {
    console.error(`[PromoJobsService] Job ${job.id} - Erro ao atualizar dados iniciais:`, e.message);
  }

  let token = null;

  console.log(`[PromoJobsService] Job ${job.id} - Iniciando processamento...`);

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

      // aplica filtro de % máx
      if (!isEligible(it, { mlb: null, maxDesc: filters.maxDesc }, promotion_type, benefitsGlobal, price_policy)) {
        continue;
      }

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
      } catch (e) {
        console.error(`[PromoJobsService] Job ${job.id} - Erro ao processar item ${id}:`, e.message);
        processed++; failed++;
      }

      // Atualizar progresso e dados a cada item processado
      const denom = (total && total > 0) ? total : Math.max(processed, 1);
      const pct = clampPct((processed / denom) * 100);
      
      await job.progress(pct);
      
      const updateData = {
        ...job.data,
        counters: { processed, total, success, failed },
        stateLabel: total > 0
          ? `processando ${processed}/${total}`
          : `processando ${processed}/?`,
        lastUpdate: Date.now()
      };

      try {
        await job.update(updateData);
        
        // Log a cada 10 itens processados
        if (processed % 10 === 0) {
          console.log(`[PromoJobsService] Job ${job.id} - Progresso: ${processed}/${total} (${pct}%)`);
        }
      } catch (e) {
        console.error(`[PromoJobsService] Job ${job.id} - Erro ao atualizar progresso:`, e.message);
      }
    }

    if (!page.next) break;
    token = page.next;
  }

  // Finalização com dados completos
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
  const finalData = {
    ...job.data,
    counters: { processed, total, success, failed },
    stateLabel: `concluído: ${success} ok, ${failed} erros`,
    lastUpdate: Date.now()
  };

  try {
    await job.update(finalData);
    await job.progress(100);
    console.log(`[PromoJobsService] Job ${job.id} - Finalizado: ${success} ok, ${failed} erros`);
  } catch (e) {
    console.error(`[PromoJobsService] Job ${job.id} - Erro ao finalizar:`, e.message);
  }

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
    queue.on('completed', (job, result) => {
      console.log(`PromoJobsService Job completed: ${job?.id}`, result);
    });

    console.log(`⚙️  PromoJobsService inicializado (Bull) — concurrency=${CONCURRENCY}`);
    return queue;
  },

  // ✅ MÉTODO PARA LIMPAR TODOS OS JOBS (EMERGÊNCIA)
  async clearAllJobs() {
    if (!queue) this.init();
    
    try {
      console.log('🧹 Iniciando limpeza de todos os jobs...');
      
      // Obter todos os jobs
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed', 'paused'], 0, -1);
      
      console.log(`🔍 Encontrados ${jobs.length} jobs para limpar`);
      
      // Remover cada job
      for (const job of jobs) {
        try {
          await job.remove();
          console.log(`✅ Job ${job.id} removido`);
        } catch (e) {
          console.error(`❌ Erro ao remover job ${job.id}:`, e.message);
        }
      }
      
      // Limpar filas
      await queue.clean(0, 'completed');
      await queue.clean(0, 'failed');
      await queue.clean(0, 'active');
      await queue.clean(0, 'waiting');
      await queue.clean(0, 'delayed');
      
      console.log('✅ Limpeza de jobs concluída');
      
      return { success: true, cleared: jobs.length };
    } catch (e) {
      console.error('❌ Erro na limpeza de jobs:', e.message);
      return { success: false, error: e.message };
    }
  },

  // ✅ MÉTODO PARA CANCELAR JOB ESPECÍFICO
  async cancelJob(jobId) {
    if (!queue) this.init();
    
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        return { success: false, error: 'Job não encontrado' };
      }
      
      const state = await job.getState();
      
      if (state === 'active') {
        // Tentar parar job ativo
        try {
          await job.moveToFailed(new Error('Cancelado manualmente'), true);
          console.log(`✅ Job ativo ${jobId} cancelado`);
        } catch (e) {
          // Se não conseguir mover para failed, remove diretamente
          await job.remove();
          console.log(`✅ Job ativo ${jobId} removido`);
        }
      } else {
        // Para jobs não ativos, simplesmente remove
        await job.remove();
        console.log(`✅ Job ${jobId} removido (estado: ${state})`);
      }
      
      return { success: true, message: `Job ${jobId} cancelado com sucesso` };
    } catch (e) {
      console.error(`❌ Erro ao cancelar job ${jobId}:`, e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * Cria job de aplicação/remoção em massa.
   * @param {object} opts
   *  - mlCreds, accountKey
   *  - promotion {id, type}
   *  - filters {status, maxDesc, mlb}
   *  - price_policy 'min' | 'suggested' | 'max'
   *  - action 'apply' | 'remove'
   *  - options { dryRun?: boolean, expected_total?: number }
   */
  async enqueueBulkApply(opts) {
    if (!queue) this.init();
    
    // ✅ VALIDAÇÃO ANTES DE CRIAR JOB
    if (!opts?.promotion?.id || opts.promotion.id === 'undefined' || opts.promotion.id === 'null') {
      throw new Error('promotion_id é obrigatório e não pode estar vazio');
    }
    
    if (!opts?.mlCreds?.access_token) {
      throw new Error('Credenciais ML são obrigatórias');
    }
    
    const data = {
      ...opts,
      action: opts.action || 'apply',
      // normaliza tipo aqui por segurança
      promotion: {
        id: String(opts?.promotion?.id || ''),
        type: String(opts?.promotion?.type || '').toUpperCase()
      },
      createdAt: Date.now()
    };
    
    const job = await queue.add(
      data,
      {
        removeOnComplete: 5, // Manter menos jobs completos para reduzir overhead
        removeOnFail: 3,     // Manter alguns jobs com falha para debug
        attempts: 1
      }
    );
    
    console.log(`[PromoJobsService] Job ${job.id} criado para ${data.action} ${data.promotion.type} ${data.promotion.id}`);
    return job?.id;
  },

  // Jobs para o painel (lista)
  async listRecent(n = 25) {
    if (!queue) this.init();
    
    try {
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'], 0, n - 1, false);

      const map = await Promise.all(
        jobs.map(async (j) => {
          try {
            const state = await j.getState().catch(() => 'unknown');
            const d = j.data || {};
            const counters = d.counters || {};
            const processed = Number(counters.processed ?? 0);
            const total = Number(counters.total ?? 0);
            const success = Number(counters.success ?? 0);
            const failed = Number(counters.failed ?? 0);

            // Progresso mais confiável
            let progress = 0;
            if (total > 0) {
              progress = clampPct((processed / total) * 100);
            } else {
              const jobProgress = await j.progress().catch(() => 0);
              progress = clampPct(jobProgress);
            }

            // título padrão
            const title = d?.promotion?.id && d?.promotion?.id !== 'undefined' && d?.promotion?.id !== 'null'
              ? `${d.action === 'remove' ? 'Removendo' : 'Aplicando'} ${d.promotion.type} ${d.promotion.id}`
              : 'Job de promoção (dados inválidos)';

            // Label mais consistente
            let stateLabel = d.stateLabel || state;
            if (state === 'active') {
              stateLabel = total > 0 ? `processando ${processed}/${total}` : `processando ${processed}/?`;
            } else if (state === 'completed') {
              stateLabel = `concluído: ${success} ok, ${failed} erros`;
            } else if (state === 'waiting') {
              stateLabel = 'aguardando';
            } else if (state === 'failed') {
              stateLabel = 'falhou';
            }

            // resultado só quando concluído
            const result = state === 'completed' ? (j.returnvalue || null) : null;

            return {
              id: j.id,
              title,
              state: stateLabel,
              progress,
              processed,
              total,
              counters: { processed, total, success, failed },
              created_at: new Date(j.timestamp).toISOString(),
              updated_at: new Date(j.processedOn || d.lastUpdate || j.timestamp).toISOString(),
              result,
              label: title
            };
          } catch (e) {
            console.error(`[PromoJobsService] Erro ao processar job ${j.id}:`, e.message);
            return {
              id: j.id,
              title: 'Job com erro',
              state: 'error',
              progress: 0,
              processed: 0,
              total: 0,
              counters: { processed: 0, total: 0, success: 0, failed: 0 },
              created_at: new Date(j.timestamp).toISOString(),
              updated_at: new Date().toISOString(),
              result: null,
              label: 'Job com erro'
            };
          }
        })
      );
      
      console.log(`[PromoJobsService] Retornando ${map.length} jobs`);
      return map;
    } catch (e) {
      console.error('[PromoJobsService] Erro ao listar jobs:', e.message);
      return [];
    }
  },

  // Detalhe do job
  async jobDetail(job_id) {
    if (!queue) this.init();
    
    try {
      const j = await queue.getJob(job_id);
      if (!j) return null;

      const state = await j.getState().catch(() => 'unknown');
      const d = j.data || {};
      const counters = d.counters || {};
      const processed = Number(counters.processed ?? 0);
      const total = Number(counters.total ?? 0);
      const success = Number(counters.success ?? 0);
      const failed = Number(counters.failed ?? 0);

      let progress = 0;
      if (total > 0) {
        progress = clampPct((processed / total) * 100);
      } else {
        const jobProgress = await j.progress().catch(() => 0);
        progress = clampPct(jobProgress);
      }

      let stateLabel = d.stateLabel || state;
      if (state === 'active') {
        stateLabel = total > 0 ? `processando ${processed}/${total}` : `processando ${processed}/?`;
      } else if (state === 'completed') {
        stateLabel = `concluído: ${success} ok, ${failed} erros`;
      }

      return {
        id: j.id,
        state: stateLabel,
        progress,
        processed,
        total,
        data: {
          ...d,
          counters: { processed, total, success, failed }
        },
        result: state === 'completed' ? (j.returnvalue || null) : null
      };
    } catch (e) {
      console.error(`[PromoJobsService] Erro ao obter detalhes do job ${job_id}:`, e.message);
      return null;
    }
  },

  // Método para compatibilidade com rota existente
  async enqueueApplyMass(opts) {
    return { id: await this.enqueueBulkApply(opts) };
  }
};