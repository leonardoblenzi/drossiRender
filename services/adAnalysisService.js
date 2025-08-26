// services/adAnalysisService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

// -------- helpers de ambiente/urls --------
function urls() {
  return {
    users_me:      (config?.urls?.users_me) || 'https://api.mercadolibre.com/users/me',
    items_base:    (config?.urls?.items)    || 'https://api.mercadolibre.com/items',
    orders_search: (config?.urls?.orders_search) || 'https://api.mercadolibre.com/orders/search',

    // Opcional (Product Ads) — ajuste para a rota de métricas disponível na sua conta
    // Exemplo comum: 'https://api.mercadolibre.com/ads/product-ads/statistics/search'
    ads_stats_search: (config?.urls?.ads_stats_search) || null,
  };
}

const TZ = 'America/Sao_Paulo';

// ---------- Formatadores ----------
function formatPtBr(dateIso) {
  if (!dateIso) return '—';
  try {
    const d = new Date(dateIso);
    return d.toLocaleString('pt-BR', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return '—'; }
}

function humanSince(dateIso, ref = new Date()) {
  if (!dateIso) return '—';
  const now = +ref;
  const then = new Date(dateIso).getTime();
  let diff = Math.max(0, now - then);

  const day = 24*60*60*1000;
  const hour = 60*60*1000;
  const min = 60*1000;

  const d = Math.floor(diff / day); diff -= d*day;
  const h = Math.floor(diff / hour); diff -= h*hour;
  const m = Math.floor(diff / min);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const day = 86400000, hour = 3600000, min = 60000;
  const d = Math.floor(ms / day);  ms -= d*day;
  const h = Math.floor(ms / hour); ms -= h*hour;
  const m = Math.floor(ms / min);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function mapListingTypeId(id) {
  const map = {
    gold_pro: 'Premium',
    gold_premium: 'Premium',
    gold_special: 'Clássico',
    gold: 'Clássico',
    classic: 'Clássico',
    free: 'Grátis',
  };
  return map[id] || 'Outro';
}

// ---------- Datas ----------
const toISO = (d) => new Date(d).toISOString();
function daysAgo(n, ref = new Date()) {
  const d = new Date(ref);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// -------- auth helpers (reuso de token no lote) --------
async function prepararAuthState(options = {}) {
  if (options?.token && options?.creds) return options;
  const token = await TokenService.renovarTokenSeNecessario(options?.mlCreds || {});
  return { token, creds: options?.mlCreds || {}, key: (options?.accountKey || options?.key || 'conta') };
}

async function authFetch(url, init, state) {
  const call = async (tok) => {
    const headers = { ...(init?.headers || {}), Authorization: `Bearer ${tok}` };
    return fetch(url, { ...init, headers });
  };
  let r = await call(state.token);
  if (r.status !== 401) return r;

  // 401 → renova e tenta novamente
  const renewed = await TokenService.renovarToken(state.creds);
  state.token = renewed.access_token;
  return call(state.token);
}

// --------- Ad helpers (opcional) ----------
async function fetchAdsCostForItem(itemId, fromIso, toIso, state) {
  const U = urls();
  if (!U.ads_stats_search) {
    return { available: false, cost: null };
  }
  try {
    // IMPORTANTE: a sintaxe exata pode variar por rollout/região/conta.
    // Ajuste os params conforme sua doc de Ads. Exemplo comum:
    // GET /ads/product-ads/statistics/search?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&item_id=MLB123&granularity=summary
    const p = new URLSearchParams({
      date_from: fromIso.slice(0,10),
      date_to: toIso.slice(0,10),
      item_id: itemId,
      granularity: 'summary'
    });

    const r = await authFetch(`${U.ads_stats_search}?${p.toString()}`, { method: 'GET' }, state);
    if (!r.ok) throw new Error(`Ads stats HTTP ${r.status}`);
    const data = await r.json();

    // Normaliza custo: tente achar "cost" ou somatório no payload
    let cost = null;
    if (Array.isArray(data?.results)) {
      cost = data.results.reduce((acc, row) => acc + (Number(row?.cost) || 0), 0);
    } else if (Number.isFinite(data?.cost)) {
      cost = Number(data.cost);
    }

    return { available: true, cost: Number.isFinite(cost) ? cost : 0 };
  } catch (e) {
    return { available: false, cost: null, error: e?.message || String(e) };
  }
}

// --------- Orders helpers ----------
function pickOrderDate(o) {
  return o?.date_closed || o?.date_created || o?.date_last_updated || null;
}

function isPaid(o) {
  const s = String(o?.status || '').toLowerCase();
  return ['paid', 'confirmed', 'partially_paid'].includes(s) || (o?.tags || []).includes('paid');
}

function revenueForItemFromOrder(order, mlbId) {
  // preferir granularidade por item dentro do pedido
  let revenue = 0;
  if (Array.isArray(order?.order_items)) {
    for (const it of order.order_items) {
      if (it?.item?.id === mlbId) {
        const q = Number(it?.quantity) || 0;
        const price = Number(it?.unit_price ?? it?.full_unit_price ?? 0) || 0;
        revenue += q * price;
      }
    }
  }
  // fallback: se não achou granularidade, aprox. pelo paid_amount quando pedido tem um único item do anúncio
  if (revenue === 0 && (order?.order_items?.length === 1) && order?.order_items[0]?.item?.id === mlbId) {
    revenue = Number(order?.paid_amount ?? order?.total_amount ?? 0) || 0;
  }
  return revenue;
}

async function fetchPaidOrdersForItemLastNDays(sellerId, mlbId, nDays, state) {
  const U = urls();
  const baseHeaders = { 'Content-Type': 'application/json' };
  const fromIso = toISO(daysAgo(nDays));
  const toIso = toISO(new Date());

  const all = [];
  let offset = 0;
  const limit = 50;

  // Tenta com filtros de data no endpoint
  // (algumas versões aceitam order.date_created.from/to; se não, caímos no filtro em memória)
  let supportsDateFilter = true;

  while (true) {
    let q = new URLSearchParams({
      seller: String(sellerId),
      item: String(mlbId),
      sort: 'date_desc',
      limit: String(limit),
      offset: String(offset),
      'order.status': 'paid',
      'order.date_created.from': fromIso,
      'order.date_created.to': toIso
    });

    let r = await authFetch(`${U.orders_search}?${q.toString()}`, { method: 'GET', headers: baseHeaders }, state);

    if (r.status === 400 && supportsDateFilter) {
      // fallback: sem filtros de data suportados → remove e filtra em memória
      supportsDateFilter = false;
      q = new URLSearchParams({
        seller: String(sellerId),
        item: String(mlbId),
        sort: 'date_desc',
        limit: String(limit),
        offset: String(offset),
        'order.status': 'paid'
      });
      r = await authFetch(`${U.orders_search}?${q.toString()}`, { method: 'GET', headers: baseHeaders }, state);
    }
    if (!r.ok) throw new Error(`orders/search HTTP ${r.status}`);
    const payload = await r.json();
    const arr = Array.isArray(payload?.results) ? payload.results :
                (Array.isArray(payload?.orders) ? payload.orders : []);

    // Filtra pagos e, se necessário, por data em memória
    const filtered = arr.filter(isPaid).filter(o => {
      if (supportsDateFilter) return true;
      const d = pickOrderDate(o);
      return d && d >= fromIso && d <= toIso;
    });

    all.push(...filtered);
    if (arr.length < limit) break;
    offset += limit;
  }

  return { fromIso, toIso, orders: all };
}

function aggregateSalesWindows(orders, mlbId, now = new Date()) {
  // Ordena por data ascendente (pro cálculo do tempo médio entre vendas)
  const paidSorted = orders
    .map(o => ({ o, t: new Date(pickOrderDate(o)).getTime() }))
    .filter(x => x.t)
    .sort((a,b) => a.t - b.t);

  // tempo médio entre vendas
  if (paidSorted.length >= 2) {
    let sumDiff = 0;
    for (let i = 1; i < paidSorted.length; i++) {
      sumDiff += (paidSorted[i].t - paidSorted[i-1].t);
    }
    var avgMs = sumDiff / (paidSorted.length - 1);
  } else {
    var avgMs = null;
  }

  // janelas relativas
  const tNow = +now;
  const d30 = tNow - 30*86400000;
  const d60 = tNow - 60*86400000;
  const d90 = tNow - 90*86400000;

  const initAgg = () => ({ vendas: 0, receita: 0 });
  const agg30 = initAgg(), agg60 = initAgg(), agg90 = initAgg();

  for (const { o, t } of paidSorted) {
    const rev = revenueForItemFromOrder(o, mlbId);
    if (t >= d30) { agg30.vendas++; agg30.receita += rev; }
    if (t >= d60) { agg60.vendas++; agg60.receita += rev; }
    if (t >= d90) { agg90.vendas++; agg90.receita += rev; }
  }

  // última venda (para UI): se não houver, devolvemos null aqui;
  // quem chama poderá substituir por date_created do item.
  const last = paidSorted.length ? new Date(paidSorted[paidSorted.length - 1].t) : null;

  // currency: tenta do primeiro pedido
  const currency = orders?.[0]?.currency_id || null;

  return {
    avg_interval_ms: avgMs,
    avg_interval_human: avgMs ? humanDuration(avgMs) : '—',
    last_sale_iso: last ? last.toISOString() : null,
    windows: {
      d30: { vendas: agg30.vendas, receita: Math.round(agg30.receita * 100) / 100 },
      d60: { vendas: agg60.vendas, receita: Math.round(agg60.receita * 100) / 100 },
      d90: { vendas: agg90.vendas, receita: Math.round(agg90.receita * 100) / 100 },
    },
    currency_id: currency
  };
}

// -------- núcleo do serviço --------
class AdAnalysisService {
  /**
   * Analisa 1 MLB e retorna:
   * - tipo do anúncio
   * - data_criacao
   * - última venda (ou data_criacao se não houver)
   * - vendas e receita nos últimos 30/60/90d
   * - tempo médio entre vendas
   * - gasto com Ads (30/60/90d) — se o Ads API estiver habilitado
   */
  static async analisarUm(mlbId, options = {}) {
    const U = urls();
    const state = await prepararAuthState(options);
    const log = (options.logger || console).log;

    try {
      const baseHeaders = { 'Content-Type': 'application/json' };

      // 1) seller atual
      const rMe = await authFetch(U.users_me, { method: 'GET', headers: baseHeaders }, state);
      if (!rMe.ok) throw new Error(`users/me falhou: HTTP ${rMe.status}`);
      const me = await rMe.json();

      // 2) item
      const rItem = await authFetch(`${U.items_base}/${mlbId}`, { method: 'GET', headers: baseHeaders }, state);
      if (!rItem.ok) {
        const msg = rItem.status === 404 ? 'Item não encontrado' : `Erro ao buscar item: HTTP ${rItem.status}`;
        return { success: false, mlb: mlbId, status: 'ERRO', message: msg };
      }
      const item = await rItem.json();

      if (item.seller_id !== me.id) {
        return { success: false, mlb: mlbId, status: 'FORA_DA_CONTA', message: 'Este anúncio não pertence à conta selecionada.' };
      }

      const tipoLabel = mapListingTypeId(item.listing_type_id);
      const dataCriacao = item.date_created || null;

      // 3) vendas dos últimos 90 dias
      const { orders } = await fetchPaidOrdersForItemLastNDays(me.id, mlbId, 90, state);
      const agg = aggregateSalesWindows(orders, mlbId);

      // 4) última venda: se não houver, usa date_created
      const ultimaVendaIso = agg.last_sale_iso || dataCriacao;
      const ultimaVendaFmt = formatPtBr(ultimaVendaIso);

      // 5) Ads (opcional) — busca custo nas mesmas janelas
      const nowIso = toISO(new Date());
      const d30Iso = toISO(daysAgo(30));
      const d60Iso = toISO(daysAgo(60));
      const d90Iso = toISO(daysAgo(90));

      const [ads30, ads60, ads90] = await Promise.all([
        fetchAdsCostForItem(mlbId, d30Iso, nowIso, state),
        fetchAdsCostForItem(mlbId, d60Iso, nowIso, state),
        fetchAdsCostForItem(mlbId, d90Iso, nowIso, state),
      ]);

      const adsDisponivel = !!(ads30.available || ads60.available || ads90.available);

      return {
        success: true,
        mlb: mlbId,
        status: 'OK',

        // Dados do anúncio
        tipo: tipoLabel,
        tipo_raw: item.listing_type_id || null,
        data_criacao: dataCriacao,
        data_criacao_fmt: formatPtBr(dataCriacao),

        // Última venda
        ultima_venda: ultimaVendaIso,
        ultima_venda_fmt: ultimaVendaFmt,
        tempo_desde_ultima_venda: humanSince(ultimaVendaIso),

        // Vendas e receita
        vendas_30d: agg.windows.d30.vendas,
        vendas_60d: agg.windows.d60.vendas,
        vendas_90d: agg.windows.d90.vendas,

        receita_30d: agg.windows.d30.receita,
        receita_60d: agg.windows.d60.receita,
        receita_90d: agg.windows.d90.receita,
        moeda: agg.currency_id,

        // Tempo médio entre vendas
        tempo_medio_entre_vendas_ms: agg.avg_interval_ms,
        tempo_medio_entre_vendas: agg.avg_interval_human,

        // Ads
        ads_disponivel: adsDisponivel,
        gasto_ads_30d: ads30.cost,
        gasto_ads_60d: ads60.cost,
        gasto_ads_90d: ads90.cost,
        ads_observacao: adsDisponivel ? null : 'Métricas de Ads indisponíveis (verificar escopos/URL de Ads no config).',
      };
    } catch (err) {
      log?.(`[${state.key}] analisarUm erro`, err);
      return { success: false, mlb: mlbId, status: 'ERRO', message: err?.message || String(err) };
    }
  }

  /**
   * Lote – reusa um token; só renova no 401.
   * Retorna array de resultados na mesma ordem dos MLBs.
   */
  static async analisarLote(mlbIds = [], delayMs = 300, options = {}) {
    const state = await prepararAuthState(options);
    const resultados = [];

    for (let i = 0; i < mlbIds.length; i++) {
      const id = String(mlbIds[i] || '').trim();
      if (!id) continue;

      const r = await this.analisarUm(id, state);
      resultados.push(r);

      if (delayMs && i < mlbIds.length - 1) {
        await new Promise(r => setTimeout(r, Number(delayMs) || 0));
      }
    }
    return resultados;
  }
}

module.exports = AdAnalysisService;
