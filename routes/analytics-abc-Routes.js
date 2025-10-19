// routes/analytics-abc-Routes.js
// Curva ABC em tempo real via API do Mercado Livre (sem banco)

'use strict';

const express = require('express');
const router = express.Router();

const _fetch = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
const fetchRef = (...args) => _fetch(...args);

/** Utils */
function parseAccounts(v) { return (v || '').split(',').map(s => s.trim()).filter(Boolean); }
function isoStart(d) { return `${d}T00:00:00.000-00:00`; }
function isoEnd(d)   { return `${d}T23:59:59.999-00:00`; }

/** Shift de YYYY-MM-DD em dias (UTC) */
function ymdShift(ymd, days) {
  const [y, m, d] = (ymd || '').split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + (days || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function ymdMin(a, b) { return (new Date(a) <= new Date(b)) ? a : b; }

/** Diferença de dias (inteiros) por DIA-UTC entre âncora (YYYY-MM-DD) e ISO do pedido */
function daysDiffFromAnchorUTC(anchorYMD, iso) {
  if (!anchorYMD || !iso) return Infinity;
  const [ay, am, ad] = anchorYMD.split('-').map(Number);
  const anchorDayMs = Date.UTC(ay, (am || 1) - 1, ad || 1);
  const d = new Date(iso);
  const orderDayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((anchorDayMs - orderDayMs) / 86400000);
}
function inRangeUTC(iso, fromYMD, toYMD) {
  const ms = new Date(iso).getTime();
  return ms >= new Date(isoStart(fromYMD)).getTime() && ms <= new Date(isoEnd(toYMD)).getTime();
}

/** Token provider */
async function getToken(app, req, accountId) {
  const injected = app.get('getAccessTokenForAccount');
  if (typeof injected === 'function') return injected(accountId, req);
  try {
    const { getAccessTokenForAccount } = require('../services/ml-auth');
    return getAccessTokenForAccount(accountId, req);
  } catch {
    throw new Error(
      `Não foi possível obter token para a conta "${accountId}". ` +
      `Configure app.set('getAccessTokenForAccount', fn) ou crie services/ml-auth.js`
    );
  }
}

/** Seller ID do token */
async function getSellerId(token) {
  const r = await fetchRef('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`users/me ${r.status}`);
  const me = await r.json();
  return me.id;
}

/** FULL? */
function isFull(order) {
  return order?.shipping?.logistic_type === 'fulfillment';
}

/** Paginador de pedidos pagos no intervalo solicitado */
async function* iterOrders({ token, sellerId, date_from, date_to }) {
  let offset = 0;
  const limit = 50;

  for (;;) {
    const url = new URL('https://api.mercadolibre.com/orders/search');
    url.searchParams.set('seller', sellerId);
    url.searchParams.set('order.status', 'paid');
    url.searchParams.set('order.date_created.from', isoStart(date_from));
    url.searchParams.set('order.date_created.to', isoEnd(date_to));
    url.searchParams.set('sort', 'date_desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        const r = await fetchRef(url, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429) {
          if (attempts >= 5) throw new Error('Rate limited (429) repetido');
          await new Promise(res => setTimeout(res, 400 * attempts));
          continue;
        }
        if (!r.ok) throw new Error(`orders/search ${r.status}`);
        const data = await r.json();
        for (const o of (data.results || [])) yield o;

        offset += limit;
        if (offset >= (data.paging?.total || 0)) return;
        break;
      } catch (e) {
        if (attempts >= 3) throw e;
        await new Promise(res => setTimeout(res, 300 * attempts));
      }
    }
  }
}

/** Key de agregação */
function makeKey({ mlb, sku }, group_by) {
  if (group_by === 'mlb') return String(mlb);
  return `${mlb}|${sku || ''}`;
}

/** Classificação ABC */
function classifyABC(rows, { metric = 'units', aCut = 0.80, bCut = 0.95 } = {}) {
  const sorted = rows.slice().sort((x, y) => (y[metric] || 0) - (x[metric] || 0));
  const total = sorted.reduce((s, r) => s + (r[metric] || 0), 0) || 1;
  let cum = 0;
  for (const r of sorted) {
    cum += r[metric] || 0;
    const share = cum / total;
    r.share_cum = share;
    r.curve = share <= aCut ? 'A' : (share <= bCut ? 'B' : 'C');
  }
  return { total, rows: sorted };
}

/** Defaults */
function parseCommonQuery(q) {
  const hasMetric   = typeof q.metric === 'string';
  const hasGroupBy  = typeof q.group_by === 'string';
  const hasACut     = Object.prototype.hasOwnProperty.call(q, 'a_cut');
  const hasBCut     = Object.prototype.hasOwnProperty.call(q, 'b_cut');

  return {
    date_from: q.date_from,
    date_to:   q.date_to,
    accounts:  parseAccounts(q.accounts || ''),

    metric:   hasMetric  ? (q.metric === 'revenue' ? 'revenue' : 'units') : 'revenue',
    group_by: hasGroupBy ? (q.group_by === 'mlb' ? 'mlb' : 'mlb_sku')     : 'mlb',

    a_cut: !hasACut || isNaN(parseFloat(q.a_cut))
      ? 0.75 : Math.max(0.50, Math.min(0.95, parseFloat(q.a_cut))),

    b_cut: !hasBCut || isNaN(parseFloat(q.b_cut))
      ? 0.92 : Math.max(0.70, Math.min(0.99, parseFloat(q.b_cut))),

    min_units: Math.max(1, parseInt(q.min_units || '1', 10)),
    full: (q.full || 'all')
  };
}

/** GET /api/analytics/abc-ml/summary */
router.get('/abc-ml/summary', async (req, res) => {
  const p = parseCommonQuery(req.query);
  const { date_from, date_to, accounts, full, metric, group_by, a_cut, b_cut } = p;

  if (!date_from || !date_to || accounts.length === 0) {
    return res.status(400).json({ error: 'date_from, date_to, accounts são obrigatórios' });
  }

  try {
    const map = new Map();

    for (const acc of accounts) {
      const token = await getToken(req.app, req, acc);
      const sellerId = await getSellerId(token);

      for await (const order of iterOrders({ token, sellerId, date_from, date_to })) {
        const fullOrder = isFull(order);

        for (const it of (order.order_items || [])) {
          const mlb = it?.item?.id;
          if (!mlb) continue;

          const sku = it?.item?.seller_sku || it?.item?.seller_custom_field || null;
          const q = Number(it?.quantity || 0);
          if (q <= 0) continue;

          if (full === 'only' && !fullOrder) continue;
          if (full === 'skip' && fullOrder) continue;

          const unitPrice = Number(it?.unit_price || 0);
          const revenue = unitPrice * q;

          const key = makeKey({ mlb, sku }, group_by);
          const row = map.get(key) || {
            mlb,
            sku: group_by === 'mlb' ? null : sku,
            title: it?.item?.title,
            logistic_type: order?.shipping?.logistic_type,
            units: 0,
            revenue: 0,
            revenue_cents: 0,
            is_full: false
          };
          row.units += q;
          row.revenue += revenue;
          row.revenue_cents = Math.round(row.revenue * 100);
          row.is_full = row.is_full || fullOrder;
          map.set(key, row);
        }
      }
    }

    const labeled = classifyABC(Array.from(map.values()), {
      metric: metric === 'revenue' ? 'revenue' : 'units',
      aCut: a_cut,
      bCut: b_cut
    }).rows;

    const totalUnits = labeled.reduce((s, r) => s + (r.units || 0), 0);
    const totalRevenueCents = labeled.reduce((s, r) => s + (r.revenue_cents || 0), 0);

    function aggCurve(curve) {
      const arr = labeled.filter(r => r.curve === curve);
      const units = arr.reduce((s, r) => s + (r.units || 0), 0);
      const revenue_cents = arr.reduce((s, r) => s + (r.revenue_cents || 0), 0);
      const items_count = arr.length;
      const ticket_avg_cents = units > 0 ? Math.round(revenue_cents / units) : 0;
      const revenue_share = totalRevenueCents > 0 ? revenue_cents / totalRevenueCents : 0;
      return { units, revenue_cents, items_count, ticket_avg_cents, revenue_share };
    }

    const cards = { A: aggCurve('A'), B: aggCurve('B'), C: aggCurve('C') };

    res.json({
      meta: { date_from, date_to, accounts, full, metric, group_by, a_cut, b_cut },
      totals: {
        items_total: labeled.length,
        units_total: totalUnits,
        revenue_cents_total: totalRevenueCents
      },
      curves: {
        A: { count_items: labeled.filter(r => r.curve === 'A').length, share: cards.A.revenue_share },
        B: { count_items: labeled.filter(r => r.curve === 'B').length, share: cards.B.revenue_share },
        C: { count_items: labeled.filter(r => r.curve === 'C').length, share: cards.C.revenue_share }
      },
      curve_cards: {
        A: cards.A,
        B: cards.B,
        C: cards.C,
        TOTAL: {
          units: cards.A.units + cards.B.units + cards.C.units,
          revenue_cents: cards.A.revenue_cents + cards.B.revenue_cents + cards.C.revenue_cents,
          items_count: labeled.length,
          ticket_avg_cents: (cards.A.units + cards.B.units + cards.C.units) > 0
            ? Math.round(
              (cards.A.revenue_cents + cards.B.revenue_cents + cards.C.revenue_cents) /
              (cards.A.units + cards.B.units + cards.C.units)
            ) : 0
        }
      },
      top5: {
        A: labeled.filter(r => r.curve === 'A').slice(0, 5),
        B: labeled.filter(r => r.curve === 'B').slice(0, 5),
        C: labeled.filter(r => r.curve === 'C').slice(0, 5)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'abc-ml summary failed', detail: e.message });
  }
});
/** ------- HTTP helper + ADS v2 helpers ------- */

/** GET JSON com retry simples + coleta de debug */
async function httpGetJson(url, headers, retries = 3, dbgArr = null) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const r = await fetchRef(url, { headers });
    const status = r.status;
    const text = await r.text();
    if (dbgArr) {
      dbgArr.push({
        type: 'http',
        url,
        status,
        body: text.slice(0, 1024)
      });
    }
    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise(res => setTimeout(res, 400 * (i + 1)));
      continue;
    }
    if (!r.ok) {
      lastErr = new Error(`GET ${url} -> ${status}`);
      break;
    }
    try { return JSON.parse(text); } catch (e) { lastErr = e; break; }
  }
  if (lastErr) throw lastErr;
  return null;
}

/** Lê mapeamento de advertiser_id por site via env ou query */
function getAdvertiserIdFromConfig(req, site) {
  const qKey = `adv_id_${site}`;
  if (req.query && req.query[qKey]) return String(req.query[qKey]);

  const envKey = `ADS_ADV_ID_${site}`;
  if (process.env[envKey]) return String(process.env[envKey]);

  if (process.env.ADS_ADV_ID_MAP) {
    try {
      const m = JSON.parse(process.env.ADS_ADV_ID_MAP);
      if (m && m[site]) return String(m[site]);
    } catch {}
  }
  return null;
}

/** Descobre advertiser_id(s) para o token (leve). */
async function getAdvertisersForToken(token, dbgArr) {
  const url = 'https://api.mercadolibre.com/advertising/advertisers?product_id=PADS';
  try {
    const j = await httpGetJson(url, {
      Authorization: `Bearer ${token}`,
      'Api-Version': '1',
      'Content-Type': 'application/json'
    }, 2, dbgArr);
    const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
    const map = new Map();
    for (const a of list) {
      if (!map.has(a.site_id)) map.set(a.site_id, a.advertiser_id);
    }
    return map;
  } catch (e) {
    if (dbgArr) dbgArr.push({ type: 'advertisers_error', url, message: e.message });
    return new Map();
  }
}

/** Status do anúncio (active/paused/…) */
async function fetchItemStatus({ token, site, itemId, dbgArr }) {
  const url = `https://api.mercadolibre.com/advertising/${site}/product_ads/items/${itemId}`;
  try {
    const json = await httpGetJson(url, { Authorization: `Bearer ${token}`, 'api-version': '2' }, 2, dbgArr);
    const raw = String(json?.status || '').toLowerCase();
    if (raw === 'active') return 'active';
    if (raw === 'paused') return 'paused';
    return 'none';
  } catch (e) {
    if (dbgArr) dbgArr.push({ type: 'item_status_error', url, message: e.message });
    return 'none';
  }
}

/** Métricas single por item (Ads) */
async function fetchAdsMetricsSingle({ token, site, itemId, date_from, date_to, channels = ['marketplace'], dbgArr }) {
  let clicks = 0, prints = 0, cost = 0, acos = null, total_amount = 0, direct_amount = 0, indirect_amount = 0;

  const metrics = 'clicks,prints,cost,acos,total_amount,direct_amount,indirect_amount,units_quantity';
  const base = `https://api.mercadolibre.com/advertising/${site}/product_ads/ads/${itemId}`;
  const headers = { Authorization: `Bearer ${token}`, 'api-version': '2' };
  const counted = new Set();

  async function tryChannel(requestedChannel) {
    const qs = new URLSearchParams({
      date_from, date_to,
      metrics,
      metrics_summary: 'true',
      channel: requestedChannel
    }).toString();
    const url = `${base}?${qs}`;
    const j = await httpGetJson(url, headers, 2, dbgArr);

    const respChannel = String(j?.channel || '').toLowerCase();
    if (respChannel) {
      if (counted.has(respChannel)) return;
      if (requestedChannel && respChannel !== requestedChannel) return;
      counted.add(respChannel);
    } else {
      if (counted.has(requestedChannel || 'unknown')) return;
      counted.add(requestedChannel || 'unknown');
    }

    const m = j?.metrics_summary || j?.metrics || j || {};
    clicks += Number(m.clicks || 0);
    prints += Number(m.prints || 0);
    cost   += Number(m.cost || 0);
    total_amount   += Number(m.total_amount || 0);
    direct_amount  += Number(m.direct_amount || 0);
    indirect_amount+= Number(m.indirect_amount || 0);
    if (m.acos != null) acos = Number(m.acos);
  }

  for (const ch of channels) {
    try { await tryChannel(ch); } catch {}
  }

  const spend_cents = Math.round(cost * 100);
  const revenue_amount = total_amount > 0 ? total_amount : (direct_amount + indirect_amount);
  const revenue_cents = Math.round(revenue_amount * 100);
  const had_activity = (clicks + prints + spend_cents + revenue_cents) > 0;

  return { clicks, prints, spend_cents, revenue_cents, acos, had_activity };
}

/**
 * ADS v2 — tenta batch (advertiser) e completa com single por item
 */
async function fetchAdsMetricsByItems({ req, token, itemIds, date_from, date_to, channels = ['marketplace'], dbgAcc }) {
  const out = {};
  const ids = Array.from(new Set((itemIds || []).map(x => String(x).toUpperCase()).filter(Boolean)));
  if (!ids.length) return out;

  const bySite = new Map();
  for (const id of ids) {
    const site = id.slice(0, 3);
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(id);
  }

  const advertisersMap = await getAdvertisersForToken(token, dbgAcc.calls);

  for (const [site, arr] of bySite.entries()) {
    const forcedAdvertiser = getAdvertiserIdFromConfig(req, site);
    const advertiserId = forcedAdvertiser || advertisersMap.get(site) || null;

    if (advertiserId) {
      const CHUNK = 100;
      for (let i = 0; i < arr.length; i += CHUNK) {
        const slice = arr.slice(i, i + CHUNK);
        const agg = new Map();

        for (const channel of channels) {
          const qs = new URLSearchParams({
            limit: String(slice.length),
            offset: '0',
            date_from,
            date_to,
            metrics: 'clicks,prints,cost,acos,total_amount,direct_amount,indirect_amount',
            metrics_summary: 'true',
            aggregation: 'sum'
          });
          qs.set('filters[item_id]', slice.join(','));
          qs.set('filters[channel]', channel);

          const url = `https://api.mercadolibre.com/advertising/${site}/advertisers/${advertiserId}/product_ads/ads/search?` + qs.toString();

          try {
            const json = await httpGetJson(url, { Authorization: `Bearer ${token}`, 'api-version': '2' }, 2, dbgAcc.calls);
            const results = Array.isArray(json?.results) ? json.results : [];
            for (const r of results) {
              const itemId = String(r.item_id || '').toUpperCase();
              const prev = agg.get(itemId) || {
                clicks: 0, prints: 0, cost: 0, total_amount: 0, direct_amount: 0, indirect_amount: 0,
                status_code: 'none'
              };
              const m = r.metrics || {};
              prev.clicks += Number(m.clicks || 0);
              prev.prints += Number(m.prints || 0);
              prev.cost   += Number(m.cost || 0);
              prev.total_amount   += Number(m.total_amount || 0);
              prev.direct_amount  += Number(m.direct_amount || 0);
              prev.indirect_amount+= Number(m.indirect_amount || 0);

              const raw = String(r.status || '').toLowerCase();
              const st = raw === 'active' ? 'active' : raw === 'paused' ? 'paused' : 'none';
              prev.status_code = (prev.status_code === 'active' || st === 'active') ? 'active'
                                : (prev.status_code === 'paused' || st === 'paused') ? 'paused'
                                : 'none';

              agg.set(itemId, prev);
            }
          } catch (e) {
            dbgAcc.calls.push({ type: 'batch_error', url, message: e.message });
          }
        }

        for (const [itemId, v] of agg.entries()) {
          const spend_cents = Math.round(v.cost * 100);
          const revenue_amount = v.total_amount > 0 ? v.total_amount : (v.direct_amount + v.indirect_amount);
          const revenue_cents = Math.round(revenue_amount * 100);
          const acos = revenue_cents > 0 ? (spend_cents / revenue_cents) : null;
          const had_activity = (v.clicks + v.prints + spend_cents + revenue_cents) > 0;
          const status_text = v.status_code === 'active' ? 'Ativo' : v.status_code === 'paused' ? 'Pausado' : 'Não';

          out[itemId] = {
            status_code: v.status_code,
            status_text,
            in_campaign: v.status_code !== 'none',
            had_activity,
            clicks: v.clicks,
            impressions: v.prints,
            spend_cents,
            revenue_cents,
            acos
          };
        }
      }
    }

    const missing = arr.filter(id => !out[id]);
    dbgAcc.missingAfterSearch.push(...missing);

    for (const itemId of missing) {
      try {
        const status_code = await fetchItemStatus({ token, site, itemId, dbgArr: dbgAcc.calls });
        const status_text = status_code === 'active' ? 'Ativo' : status_code === 'paused' ? 'Pausado' : 'Não';

        const m = await fetchAdsMetricsSingle({
          token, site, itemId, date_from, date_to, channels, dbgArr: dbgAcc.calls
        });
        out[itemId] = {
          status_code,
          status_text,
          in_campaign: status_code !== 'none',
          had_activity: m.had_activity,
          clicks: m.clicks,
          impressions: m.prints,
          spend_cents: m.spend_cents,
          revenue_cents: m.revenue_cents,
          acos: (m.acos != null) ? m.acos : (m.revenue_cents > 0 ? m.spend_cents / m.revenue_cents : null)
        };
      } catch (e) {
        dbgAcc.calls.push({
          type: 'single_error',
          message: e.message,
          item: itemId
        });
        out[itemId] = {
          status_code: 'none', status_text: 'Não',
          in_campaign: false, had_activity: false,
          clicks: 0, impressions: 0, spend_cents: 0, revenue_cents: 0, acos: null
        };
      }
    }
  }

  return out;
}
/** ------- PROMO helpers (Central de Promoções / Smart Campaign / Seller Promotion) ------- **/

/** Mescla duas fontes de promo (prioriza ativo e maior %). */
// [FIX] helper de merge para não sobrescrever promo boa por promo vazia
function mergePromo(a, b) {
  const A = a || { active: false, percent: null, source: null };
  const B = b || { active: false, percent: null, source: null };
  const aPct = (A.percent != null ? Number(A.percent) : null);
  const bPct = (B.percent != null ? Number(B.percent) : null);

  // se uma estiver ativa e a outra não, mantém a ativa
  if (A.active && !B.active) return A;
  if (B.active && !A.active) return B;

  // ambas ativas (ou ambas inativas): fica com a que tiver maior % conhecida
  if (aPct != null && bPct != null) return (bPct > aPct) ? B : A;

  // somente uma tem % → use a que tem % (se empatar, prioriza A)
  if (bPct != null && aPct == null) return B;
  return A;
}

/**
 * Lê a Prices API do item e tenta inferir promoção ativa “agora”.
 * Funciona para promoções do seller e para campanhas de marketplace (smart).
 * Retorna { active: bool, percent: number|null, source: string|null }  (percent 0..1)
 */

async function fetchItemPromoNow({ token, itemId, dbgArr }) {
  const url = `https://api.mercadolibre.com/items/${itemId}/prices`;

  // helper p/ % (0..1)
  const pct = (full, price) => {
    const f = Number(full || 0), p = Number(price || 0);
    if (f > 0 && p > 0 && p < f) return 1 - (p / f);
    return null;
  };

  try {
    const j = await httpGetJson(url, { Authorization: `Bearer ${token}` }, 2, dbgArr);

    // Consolida “linhas de preço”
    const buckets = [];
    if (Array.isArray(j?.prices?.prices)) buckets.push(...j.prices.prices);
    if (Array.isArray(j?.prices))       buckets.push(...j.prices);
    if (Array.isArray(j?.reference_prices)) buckets.push(...j.reference_prices);

    // Algumas contas trazem “promotions” separadas
    const promoNodes = Array.isArray(j?.promotions) ? j.promotions : [];

    const nowMs = Date.now();
    const candidates = [];

    // 1) Preços com type=promotion dentro da janela
    for (const p of buckets) {
      const t  = String(p?.type || '').toLowerCase();
      if (t !== 'promotion') continue;

      const df = p?.conditions?.start_time || p?.date_from || p?.start_time;
      const dt = p?.conditions?.end_time   || p?.date_to   || p?.end_time;
      const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                       (!dt || nowMs <= new Date(dt).getTime());

      if (!inWindow) continue;

      const percent = pct(p?.regular_amount, p?.amount);
      if (percent !== null && percent > 0) {
        const source = p?.metadata?.campaign_id ? 'marketplace_campaign' : 'seller_promotion';
        candidates.push({ percent, source, active: true });
      }
    }

    // 2) Nó “promotions” (alguns sites retornam aqui)
    for (const p of promoNodes) {
      const st = String(p?.status || '').toLowerCase(); // active/scheduled/etc.
      const df = p?.date_from || p?.start_time;
      const dt = p?.date_to   || p?.end_time;
      const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                       (!dt || nowMs <= new Date(dt).getTime());

      // Consideramos “ativa” apenas se status indicar ativo (quando existir) E estiver na janela
      const isActive = (st ? st === 'active' : true) && inWindow;
      if (!isActive) continue;

      const percent = pct(p?.regular_amount || p?.base_price, p?.price || p?.amount);
      if (percent !== null && percent > 0) {
        const source = (p?.type || p?.campaign_type || p?.origin || 'promotion').toString();
        candidates.push({ percent, source, active: true });
      }
    }

    // 3) Fallback: linha “standard/active” com regular_amount menor que amount
    const anyPrice = (buckets || []).find(x => x?.amount);
    if (anyPrice && anyPrice?.regular_amount) {
      const percent = pct(anyPrice.regular_amount, anyPrice.amount);
      if (percent !== null && percent > 0) {
        candidates.push({ percent, source: 'inferred_from_regular_amount', active: true });
      }
    }

    // Escolhe a MAIOR % dentre as candidatas ativas
    if (candidates.length) {
      candidates.sort((a, b) => (b.percent || 0) - (a.percent || 0));
      const best = candidates[0];
      return { active: true, percent: best.percent, source: best.source };
    }

    return { active: false, percent: null, source: null };
  } catch (e) {
    dbgArr && dbgArr.push({ type: 'promo_error', url, message: e.message || String(e) });
    return { active: false, percent: null, source: null };
  }
}


/**
 * Busca promoções atuais para uma lista de itens (apenas os visíveis na página).
 * Faz 1 chamada por item (precisamos do “snapshot” do preço vigente do item).
 */
async function fetchPromosByItems({ token, itemIds, dbgAcc }) {
  const out = {};
  const ids = Array.from(new Set((itemIds || []).map(x => String(x).toUpperCase()).filter(Boolean)));
  for (const id of ids) {
    out[id] = await fetchItemPromoNow({ token, itemId: id, dbgArr: dbgAcc.calls });
  }
  return out;
}

/** --------- PROMOÇÕES (Central de Promoções) --------- */

/**
 * Tenta obter promoções ativas para os itens informados via /seller-promotions (batch).
 * Retorna map { MLB...: { active: bool, percent: number|null, source: 'seller_promotion_batch' } }
 *
 * Regras:
 * - Considera apenas itens realmente ATIVOS agora (status + janela de datas do item).
 * - Quando houver mais de uma promoção elegível para o mesmo item, mantém a de MAIOR %.
 */
async function fetchPromotionsForItemsBatch({ token, sellerId, itemIds, promosDbg }) {
  const out = {};
  const ids = Array.from(new Set((itemIds || []).map(i => String(i).toUpperCase())));
  if (!ids.length) return out;

  // helper: escolhe a melhor promo (maior %) sem perder 'active'
  const keepBetter = (prev, next) => {
    const A = prev || { active: false, percent: null, source: null };
    const B = next || { active: false, percent: null, source: null };
    const aPct = A.percent != null ? Number(A.percent) : null;
    const bPct = B.percent != null ? Number(B.percent) : null;

    // se uma é ativa e a outra não, fica com a ativa
    if (A.active && !B.active) return A;
    if (B.active && !A.active) return B;

    // ambas ativas: maior %
    if (aPct != null && bPct != null) return (bPct > aPct) ? B : A;

    // só uma tem % conhecida
    if (bPct != null && aPct == null) return B;
    return A;
  };

  // agrupa itens por site
  const bySite = new Map();
  for (const id of ids) {
    const site = id.slice(0, 3);
    if (!bySite.has(site)) bySite.set(site, new Set());
    bySite.get(site).add(id);
  }

  const base = 'https://api.mercadolibre.com';
  const headers = { Authorization: `Bearer ${token}` };
  const nowMs = Date.now();

  for (const [site, wantedSet] of bySite.entries()) {
    // 1) lista promoções do seller com status=active
    const searchUrl = new URL(`${base}/seller-promotions/search`);
    searchUrl.searchParams.set('site_id', site);
    searchUrl.searchParams.set('seller_id', String(sellerId));
    searchUrl.searchParams.set('status', 'active');

    let promos;
    try {
      promos = await httpGetJson(searchUrl.toString(), headers, 2, promosDbg);
    } catch (e) {
      promosDbg && promosDbg.push({ type: 'promos_search_error', url: String(searchUrl), message: e.message });
      continue;
    }

    const list = Array.isArray(promos?.results) ? promos.results
                : Array.isArray(promos?.promotions) ? promos.promotions
                : [];

    for (const p of list) {
      const promoId = p.id || p.promotion_id;
      if (!promoId) continue;

      // 2) pagina itens da promoção e cruza com os desejados
      let offset = 0, limit = 200;
      for (;;) {
        const itemsUrl = new URL(`${base}/seller-promotions/${promoId}/items`);
        itemsUrl.searchParams.set('offset', String(offset));
        itemsUrl.searchParams.set('limit', String(limit));

        let j;
        try {
          j = await httpGetJson(itemsUrl.toString(), headers, 2, promosDbg);
        } catch (e) {
          promosDbg && promosDbg.push({ type: 'promos_items_error', url: String(itemsUrl), message: e.message });
          break;
        }

        const arr = Array.isArray(j?.results) ? j.results
                  : Array.isArray(j?.items) ? j.items
                  : [];

        for (const it of arr) {
          const itemId = String(it.item_id || it.id || '').toUpperCase();
          if (!itemId || !wantedSet.has(itemId)) continue;

          // --- filtro de ATIVIDADE no nível do item ---
          const st = String(it.status || '').toLowerCase();    // alguns retornam "active"/"scheduled"
          const df = it.date_from || it.start_time;
          const dt = it.date_to   || it.end_time;

          const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                           (!dt || nowMs <= new Date(dt).getTime());

          // Considerar ativo somente se status indicar ativo (quando existir) E estiver na janela
          const itemActive = (st ? st === 'active' : true) && inWindow;
          if (!itemActive) continue; // ignora itens programados ou fora da janela

          // --- % aplicada: normaliza para 0..1 ---
          let pct =
            it.applied_percentage ??
            it.discount_percentage ??
            it.discount_rate ??
            it.benefit_percentage ??
            null;
          if (pct != null) {
            pct = Number(pct);
            if (!Number.isFinite(pct)) pct = null;
            else if (pct > 1) pct = pct / 100; // alguns sites retornam 18 -> 0.18
            if (pct <= 0) pct = null;
          }

          const next = { active: true, percent: pct, source: 'seller_promotion_batch' };
          out[itemId] = keepBetter(out[itemId], next);
        }

        const total = j?.paging?.total ?? j?.total ?? arr.length;
        offset += limit;
        if (offset >= total) break;
      }
    }
  }

  return out;
}
/** [FIX] corrigido: usar /items/{id}/prices aqui também quando batch falhar */
async function fetchPromotionForItemFallback({ token, itemId, promosDbg }) {
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const u = `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/prices`;
    const j = await httpGetJson(u, headers, 2, promosDbg);

    const prices = [];
    if (Array.isArray(j?.prices?.prices)) prices.push(...j.prices.prices);
    if (Array.isArray(j?.prices)) prices.push(...j.prices);

    const current = prices.find(p => p.type === 'standard' || p.status === 'active');
    const promo   = prices.find(p => p.type === 'promotion');

    const pct = (orig, now) => {
      const o = Number(orig || 0), n = Number(now || 0);
      return (o > 0 && n > 0 && n < o) ? (1 - n / o) : null;
    };

    // preferir linha de promoção explícita
    if (promo) {
      const percent = pct(promo.regular_amount, promo.amount);
      if (percent !== null) return { active: true, percent, source: 'prices_promotion' };
    }

    // fallback: current com regular_amount menor que amount
    if (current && current.regular_amount) {
      const percent = pct(current.regular_amount, current.amount);
      if (percent !== null) return { active: true, percent, source: 'prices_regular_amount' };
    }
  } catch (e) {
    promosDbg && promosDbg.push({ type: 'prices_api_error', itemId, message: e.message });
  }

  try {
    const u = `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?attributes=price,original_price`;
    const j = await httpGetJson(u, headers, 2, promosDbg);
    const price = Number(j?.price ?? NaN);
    const original = Number(j?.original_price ?? NaN);
    if (Number.isFinite(price) && Number.isFinite(original) && original > price) {
      const pct = (original - price) / original;
      return { active: true, percent: pct, source: 'items_original_price' };
    }
  } catch (e) {
    promosDbg && promosDbg.push({ type: 'items_api_error', itemId, message: e.message });
  }

  return { active: false, percent: null, source: null };
}

async function enrichWithPromotions({ app, req, accounts, pageSlice, promosDebugEnabled }) {
  const byAccount = new Map();
  for (const r of pageSlice) {
    const acc = r._account || accounts[0];
    if (!byAccount.has(acc)) byAccount.set(acc, new Set());
    byAccount.get(acc).add(String(r.mlb || '').toUpperCase());
  }

  const result = {};
  const promos_debug = {};

  for (const acc of byAccount.keys()) {
    const token = await getToken(app, req, acc);
    const sellerId = await getSellerId(token);
    const ids = Array.from(byAccount.get(acc));

    const dbg = { calls: [] };
    try {
      const batch = await fetchPromotionsForItemsBatch({ token, sellerId, itemIds: ids, promosDbg: dbg.calls });
      Object.assign(result, batch);

      const missing = ids.filter(id => !result[id]);
      for (const id of missing) {
        try {
          result[id] = await fetchPromotionForItemFallback({ token, itemId: id, promosDbg: dbg.calls });
        } catch (e) {
          dbg.calls.push({ type: 'promo_single_error', itemId: id, message: e.message });
          result[id] = { active: false, percent: null, source: null };
        }
      }
    } finally {
      if (promosDebugEnabled) promos_debug[acc] = dbg;
    }
  }

  return { map: result, debug: promos_debug };
}

/** ================== VISITAS (items/{id}/visits) + cache e rate-limit ================== */

const VISITS_TTL_MS = 15 * 60 * 1000; // 15 minutos
const visitsCache = new Map(); // key: `${itemId}:${from}:${to}` -> { value: number, exp: ms }

function visitsCacheGet(key) {
  const hit = visitsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    visitsCache.delete(key);
    return null;
  }
  return hit.value;
}
function visitsCacheSet(key, value, ttlMs = VISITS_TTL_MS) {
  visitsCache.set(key, { value, exp: Date.now() + ttlMs });
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/** Busca visitas de um item no período (com cache e fallback gracioso) */
async function fetchVisitsSingle({ token, itemId, date_from, date_to, dbgArr }) {
  const key = `${itemId}:${date_from}:${date_to}`;
  const cached = visitsCacheGet(key);
  if (cached != null) return cached;

  const url = new URL(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/visits`);
  url.searchParams.set('date_from', date_from);
  url.searchParams.set('date_to', date_to);

  try {
    const j = await httpGetJson(url.toString(), { Authorization: `Bearer ${token}` }, 2, dbgArr);
    // formatos possíveis: { total_visits }, { visits }, { quantity }
    const v = Number(
      (j && (j.total_visits ?? j.visits ?? j.quantity)) ?? 0
    );
    const val = Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
    visitsCacheSet(key, val);
    return val;
  } catch (e) {
    dbgArr && dbgArr.push({ type: 'visits_error', url: url.toString(), message: e.message });
    visitsCacheSet(key, 0); // fallback gracioso
    return 0;
  }
}

/** Busca visitas para vários itens com chunking e delay (rate-limit amigável) */
async function fetchVisitsByItems({ token, itemIds, date_from, date_to, chunkSize = 10, delayMs = 200, dbgArr }) {
  const out = {};
  const ids = Array.from(new Set((itemIds || []).map(x => String(x).toUpperCase()).filter(Boolean)));
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    await Promise.all(slice.map(async (id) => {
      out[id] = await fetchVisitsSingle({ token, itemId: id, date_from, date_to, dbgArr });
    }));
    if (i + chunkSize < ids.length) await sleep(delayMs);
  }
  return out;
}

/** -------------------- GET /api/analytics/abc-ml/items -------------------- */
router.get('/abc-ml/items', async (req, res) => {
  const p = parseCommonQuery(req.query);
  const { date_from, date_to, accounts, full, metric, group_by, a_cut, b_cut } = p;

  const {
    curve = 'ALL',
    search = '',
    sort = 'units_desc',
    page = '1',
    limit = '50',
    include_ads = '1',
    include_ads_debug = '0',
    ads_channels = 'marketplace',
    include_promos = '1',
    include_promos_debug = '0',
    include_visits = '1',            // NOVO: controle de visitas
    include_visits_debug = '0'       // NOVO: debug de visitas
  } = req.query;

  if (!date_from || !date_to || accounts.length === 0) {
    return res.status(400).json({ error: 'date_from, date_to, accounts são obrigatórios' });
  }

  try {
    const map = new Map();

    const from90 = ymdShift(date_to, -89);
    const fetchFrom = ymdMin(date_from, from90);

    for (const acc of accounts) {
      const token = await getToken(req.app, req, acc);
      const sellerId = await getSellerId(token);

      for await (const order of iterOrders({ token, sellerId, date_from: fetchFrom, date_to })) {
        const fullOrder = isFull(order);
        const diffDays = daysDiffFromAnchorUTC(date_to, order?.date_created || '');
        const inPeriod = inRangeUTC(order?.date_created || '', date_from, date_to);

        for (const it of (order.order_items || [])) {
          const mlb = it?.item?.id;
          if (!mlb) continue;

          const sku = it?.item?.seller_sku || it?.item?.seller_custom_field || null;
          const q = Number(it?.quantity || 0);
          if (q <= 0) continue;

          if (full === 'only' && !fullOrder) continue;
          if (full === 'skip' && fullOrder) continue;

          const unitPrice = Number(it?.unit_price || 0);
          const revenue = unitPrice * q;

          const key = makeKey({ mlb, sku }, group_by);
          const row = map.get(key) || {
            mlb,
            sku: group_by === 'mlb' ? null : sku,
            title: it?.item?.title,
            logistic_type: order?.shipping?.logistic_type,
            units: 0,
            revenue: 0,
            revenue_cents: 0,
            is_full: false,
            _account: acc,

            units_7d: 0,
            units_15d: 0,
            units_30d: 0,
            units_40d: 0,
            units_60d: 0,
            units_90d: 0
          };

          if (inPeriod) {
            row.units += q;
            row.revenue += revenue;
            row.revenue_cents = Math.round(row.revenue * 100);
            row.is_full = row.is_full || fullOrder;
          }

          if (Number.isFinite(diffDays) && diffDays >= 0) {
            if (diffDays <= 6)  row.units_7d  += q;
            if (diffDays <= 14) row.units_15d += q;
            if (diffDays <= 29) row.units_30d += q;
            if (diffDays <= 39) row.units_40d += q;
            if (diffDays <= 59) row.units_60d += q;
            if (diffDays <= 89) row.units_90d += q;
          }

          map.set(key, row);
        }
      }
    }

    let rows = Array.from(map.values());

    const labeled = classifyABC(rows, {
      metric: metric === 'revenue' ? 'revenue' : 'units',
      aCut: a_cut,
      bCut: b_cut
    }).rows;

    const totalUnits = labeled.reduce((s, r) => s + (r.units || 0), 0);
    const totalRevenueCents = labeled.reduce((s, r) => s + (r.revenue_cents || 0), 0);

    labeled.forEach(r => {
      r.unit_share = totalUnits > 0 ? r.units / totalUnits : 0;
      r.revenue_share = totalRevenueCents > 0 ? r.revenue_cents / totalRevenueCents : 0;
    });

    const filtered = labeled.filter(r =>
      (curve === 'ALL' || r.curve === curve) &&
      (!search ||
        r.mlb?.toString().includes(search) ||
        (r.sku ? r.sku.toString().includes(search) : false) ||
        (r.title || '').toLowerCase().includes(search.toLowerCase()))
    );

    if (sort === 'revenue_desc') {
      filtered.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
    } else if (sort === 'share') {
      filtered.sort((a, b) => (b.revenue_share || 0) - (a.revenue_share || 0));
    } else {
      filtered.sort((a, b) => (b.units || 0) - (a.units || 0));
    }

    const pnum = Math.max(parseInt(page, 10), 1);
    const lim  = Math.min(Math.max(parseInt(limit, 10), 1), 200);
    const start = (pnum - 1) * lim;
    const pageSlice = filtered.slice(start, start + lim);
    /** ADS v2 — por anúncio (apenas itens da página) */
    const adsDebugEnabled = String(include_ads_debug) === '1';
    const adsDebug = {};
    const channels = String(ads_channels || 'marketplace')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    if (String(include_ads) === '1' && pageSlice.length) {
      const byAccount = new Map();
      for (const r of pageSlice) {
        const acc = r._account || accounts[0];
        if (!byAccount.has(acc)) byAccount.set(acc, new Set());
        byAccount.get(acc).add(String(r.mlb || '').toUpperCase());
      }

      const adsAccum = {};
      for (const acc of byAccount.keys()) {
        const token = await getToken(req.app, req, acc);
        const mlbIds = Array.from(byAccount.get(acc));
        const dbgAcc = { advertisers: {}, calls: [], missingAfterSearch: [], missingAfterSingle: [] };
        try {
          const mapMetrics = await fetchAdsMetricsByItems({
            req,
            token,
            itemIds: mlbIds,
            date_from,
            date_to,
            channels,
            dbgAcc
          });
          Object.assign(adsAccum, mapMetrics);
        } finally {
          if (adsDebugEnabled) adsDebug[acc] = dbgAcc;
        }
      }

      for (const it of pageSlice) {
        const key = String(it.mlb || '').toUpperCase();
        const met = adsAccum[key] || null;
        it.ads = met ? met : {
          status_code: 'none',
          status_text: 'Não',
          in_campaign: false,
          had_activity: false,
          clicks: 0, impressions: 0, spend_cents: 0, revenue_cents: 0, acos: null
        };
      }
    }

    // ===== PROMOÇÕES (estado ATUAL via /items/{id}/prices)
    const promosPricesDebug = {};
    let pricesPromosAccum = {};
    if (pageSlice.length) {
      const byAccountPromo = new Map();
      for (const r of pageSlice) {
        const acc = r._account || accounts[0];
        if (!byAccountPromo.has(acc)) byAccountPromo.set(acc, new Set());
        byAccountPromo.get(acc).add(String(r.mlb || '').toUpperCase());
      }

      for (const acc of byAccountPromo.keys()) {
        const token = await getToken(req.app, req, acc);
        const mlbIds = Array.from(byAccountPromo.get(acc));
        const dbgAcc = { calls: [] };
        try {
          const mapPromos = await fetchPromosByItems({ token, itemIds: mlbIds, dbgAcc });
          Object.assign(pricesPromosAccum, mapPromos);
        } finally {
          promosPricesDebug[acc] = dbgAcc;
        }
      }
    }

    /** Promoções — Central de Promoções + fallback e MESCLA com prices */
    const promosDebugEnabled = String(include_promos_debug) === '1';
    let promosDebug = {};
    if (String(include_promos) === '1' && pageSlice.length) {
      try {
        const { map: promosMap, debug } = await enrichWithPromotions({
          app: req.app, req, accounts, pageSlice, promosDebugEnabled
        });
        promosDebug = debug || {};

        for (const it of pageSlice) {
          const key = String(it.mlb || '').toUpperCase();
          const fromBatch = promosMap[key] || { active: false, percent: null, source: null };
          const fromPrices = pricesPromosAccum[key] || { active: false, percent: null, source: null };
          const merged = mergePromo(fromPrices, fromBatch);
          it.promo = {
            active: !!merged.active,
            percent: (merged.percent != null ? Number(merged.percent) : null),
            source: merged.source || fromBatch.source || fromPrices.source || null
          };
        }
      } catch (e) {
        if (promosDebugEnabled) promosDebug.__error = e.message;
        for (const it of pageSlice) {
          const key = String(it.mlb || '').toUpperCase();
          const fromPrices = pricesPromosAccum[key] || { active: false, percent: null, source: null };
          if (!it.promo) {
            it.promo = {
              active: !!fromPrices.active,
              percent: (fromPrices.percent != null ? Number(fromPrices.percent) : null),
              source: fromPrices.source || null
            };
          }
        }
      }
    } else {
      for (const it of pageSlice) {
        const key = String(it.mlb || '').toUpperCase();
        const fromPrices = pricesPromosAccum[key] || { active: false, percent: null, source: null };
        it.promo = {
          active: !!fromPrices.active,
          percent: (fromPrices.percent != null ? Number(fromPrices.percent) : null),
          source: fromPrices.source || null
        };
      }
    }

    /** ===== VISITAS + CONVERSÃO (apenas itens da página) ===== */
    const visitsDebugEnabled = String(include_visits_debug) === '1';
    const visitsDebug = {};
    if (String(include_visits) === '1' && pageSlice.length) {
      const byAccountVisits = new Map();
      for (const r of pageSlice) {
        const acc = r._account || accounts[0];
        if (!byAccountVisits.has(acc)) byAccountVisits.set(acc, new Set());
        byAccountVisits.get(acc).add(String(r.mlb || '').toUpperCase());
      }

      const visitsAccum = {};
      for (const acc of byAccountVisits.keys()) {
        const token = await getToken(req.app, req, acc);
        const mlbIds = Array.from(byAccountVisits.get(acc));
        const dbgArr = visitsDebugEnabled ? (visitsDebug[acc] = []) : null;
        const m = await fetchVisitsByItems({
          token, itemIds: mlbIds, date_from, date_to, chunkSize: 10, delayMs: 200, dbgArr
        });
        Object.assign(visitsAccum, m);
      }

      for (const it of pageSlice) {
        const key = String(it.mlb || '').toUpperCase();
        const visits = Number(visitsAccum[key] || 0);
        it.visits = visits; // inteiro
        if (visits > 0) {
          const pct = (it.units / visits) * 100;
          it.conversion_pct = Math.round(pct * 100) / 100; // duas casas
        } else {
          it.conversion_pct = null; // frontend mostra "—"
        }
      }
    } else {
      for (const it of pageSlice) {
        it.visits = 0;
        it.conversion_pct = null;
      }
    }

    // ===== resposta
    const response = { page: pnum, limit: lim, total: filtered.length, data: pageSlice };
    if (adsDebugEnabled) response.ads_debug = adsDebug;
    if (promosDebugEnabled) {
      response.promos_debug = { ...(promosDebug || {}), prices_probe: promosPricesDebug || {} };
    }
    if (visitsDebugEnabled) response.visits_debug = visitsDebug;

    res.json(response);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'abc-ml items failed', detail: e.message });
  }
});

module.exports = router;
