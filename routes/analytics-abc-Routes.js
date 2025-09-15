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

/** Token provider (usa provider injetado ou services/ml-auth) */
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

/** Key de agregação conforme group_by */
function makeKey({ mlb, sku }, group_by) {
  if (group_by === 'mlb') return String(mlb);
  return `${mlb}|${sku || ''}`; // mlb_sku
}

/** Classificação ABC com cortes configuráveis */
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

/** Defaults recomendados */
function parseCommonQuery(q) {
  const hasMetric   = typeof q.metric === 'string';
  const hasGroupBy  = typeof q.group_by === 'string';
  const hasACut     = Object.prototype.hasOwnProperty.call(q, 'a_cut');
  const hasBCut     = Object.prototype.hasOwnProperty.call(q, 'b_cut');
  const hasMinUnits = Object.prototype.hasOwnProperty.call(q, 'min_units');

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

    min_units: hasMinUnits
      ? Math.max(0, parseInt(q.min_units || '0', 10))
      : 2,

    full: (q.full || 'all') // all | only | skip
  };
}

/** GET /api/analytics/abc-ml/summary */
router.get('/abc-ml/summary', async (req, res) => {
  const p = parseCommonQuery(req.query);
  const { date_from, date_to, accounts, full, metric, group_by, a_cut, b_cut, min_units } = p;

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

    let rows = Array.from(map.values());
    if (min_units > 0) rows = rows.filter(r => (r.units || 0) >= min_units);

    const labeled = classifyABC(rows, {
      metric: metric === 'revenue' ? 'revenue' : 'units',
      aCut: a_cut,
      bCut: b_cut
    }).rows;

    // Totais globais (para %)
    const totalUnits = labeled.reduce((s, r) => s + (r.units || 0), 0);
    const totalRevenueCents = labeled.reduce((s, r) => s + (r.revenue_cents || 0), 0);

    // Aggreg por curva (para cards)
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

    const metricKey = (metric === 'revenue') ? 'revenue' : 'units';
    const totals = {
      items_total: labeled.length,
      units_total: totalUnits,
      revenue_cents_total: totalRevenueCents
    };

    // Curves meta (compat)
    const shareOf = (curve) =>
      labeled.reduce((s, r) => s + (r.curve === curve ? (r[metricKey] || 0) : 0), 0) /
      (labeled.reduce((s, r) => s + (r[metricKey] || 0), 0) || 1);

    res.json({
      meta: { date_from, date_to, accounts, full, metric: metricKey, group_by, a_cut, b_cut, min_units },
      totals,
      curves: {
        A: { count_items: labeled.filter(r => r.curve === 'A').length, share: shareOf('A') },
        B: { count_items: labeled.filter(r => r.curve === 'B').length, share: shareOf('B') },
        C: { count_items: labeled.filter(r => r.curve === 'C').length, share: shareOf('C') }
      },
      curve_cards: {
        A: cards.A,
        B: cards.B,
        C: cards.C,
        TOTAL: {
          units: totalUnits,
          revenue_cents: totalRevenueCents,
          items_count: labeled.length,
          ticket_avg_cents: totalUnits > 0 ? Math.round(totalRevenueCents / totalUnits) : 0
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

/** GET /api/analytics/abc-ml/items */
router.get('/abc-ml/items', async (req, res) => {
  const p = parseCommonQuery(req.query);
  const { date_from, date_to, accounts, full, metric, group_by, a_cut, b_cut, min_units } = p;

  // novos parâmetros (com defaults)
  const {
    curve = 'ALL',
    search = '',
    sort = 'units_desc',   // units_desc | revenue_desc | share
    page = '1',
    limit = '50',
    include_ads = '1'      // '1' para ativar Ads por padrão
  } = req.query;

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
            is_full: false,
            _account: acc, // guarda a conta do primeiro registro daquele key
          };
          row.units += q;
          row.revenue += revenue;
          row.revenue_cents = Math.round(row.revenue * 100);
          row.is_full = row.is_full || fullOrder;
          map.set(key, row);
        }
      }
    }

    let rows = Array.from(map.values());
    if (min_units > 0) rows = rows.filter(r => (r.units || 0) >= min_units);

    const labeled = classifyABC(rows, {
      metric: metric === 'revenue' ? 'revenue' : 'units',
      aCut: a_cut,
      bCut: b_cut
    }).rows;

    // Totais para % (fixos: unidades e receita)
    const totalUnits = labeled.reduce((s, r) => s + (r.units || 0), 0) || 0;
    const totalRevenueCents = labeled.reduce((s, r) => s + (r.revenue_cents || 0), 0) || 0;

    labeled.forEach(r => {
      r.unit_share = totalUnits > 0 ? r.units / totalUnits : 0;
      r.revenue_share = totalRevenueCents > 0 ? r.revenue_cents / totalRevenueCents : 0;
    });

    // Filtros (curva + busca)
    const filtered = labeled.filter(r =>
      (curve === 'ALL' || r.curve === curve) &&
      (!search ||
        r.mlb?.toString().includes(search) ||
        (r.sku ? r.sku.toString().includes(search) : false) ||
        (r.title || '').toLowerCase().includes(search.toLowerCase()))
    );

    // Ordenação
    if (sort === 'revenue_desc') {
      filtered.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
    } else if (sort === 'share') {
      filtered.sort((a, b) => (b.revenue_share || 0) - (a.revenue_share || 0));
    } else {
      filtered.sort((a, b) => (b.units || 0) - (a.units || 0)); // padrão
    }

    // Paginação
    const pnum = Math.max(parseInt(page, 10), 1);
    const lim  = Math.min(Math.max(parseInt(limit, 10), 1), 200);
    const start = (pnum - 1) * lim;
    const pageSlice = filtered.slice(start, start + lim);

    // ===== Métricas de Ads (opcional, por conta) =====
    if (String(include_ads) === '1' && pageSlice.length) {
      try {
        const AdsService = require('../services/adsService');

        // MLBs por conta (usa _account definido na agregação)
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
          const m = await AdsService.metricsPorItens({
            mlbIds,
            date_from,
            date_to,
            access_token: token,
          });
          Object.assign(adsAccum, m);
        }

        // anexa objeto ads padronizado em cada item da página
        for (const it of pageSlice) {
          const key = String(it.mlb || '').toUpperCase();
          const met = adsAccum[key] || null;

          // >>> PATCH: mapeia active com base em in_campaign OU had_activity
          const active = !!(met && (met.in_campaign || met.had_activity));

          it.ads = met ? {
            active,
            clicks: met.clicks || 0,
            impressions: met.impressions || 0,
            spend_cents: met.spend_cents || 0,
            revenue_cents: met.revenue_cents || 0,
            acos: met.acos
          } : {
            active: false, clicks: 0, impressions: 0, spend_cents: 0, revenue_cents: 0, acos: null
          };
        }
      } catch (e) {
        console.warn('⚠️ Falha ao anexar métricas de Ads:', e.message);
        pageSlice.forEach(it => { it.ads = { active: false, clicks: 0, impressions: 0, spend_cents: 0, revenue_cents: 0, acos: null }; });
      }
    }

    res.json({ page: pnum, limit: lim, total: filtered.length, data: pageSlice });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'abc-ml items failed', detail: e.message });
  }
});

module.exports = router;
