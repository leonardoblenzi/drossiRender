"use strict";

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getNowParts(tz = "America/Sao_Paulo") {
  // Pega ano/mês/dia no timezone desejado
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;

  const year = Number(get("year"));
  const month = Number(get("month")); // 1-12
  const day = Number(get("day")); // 1-31

  // total de dias no mês
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return { year, month, day, daysInMonth };
}

function buildIsoRangeBR({ year, month, dayStart, dayEnd }) {
  // Mantém -03:00 fixo (Brasil). Se quiser, depois a gente evolui pra offset real.
  const from = `${year}-${pad2(month)}-${pad2(dayStart)}T00:00:00.000-03:00`;
  const to = `${year}-${pad2(month)}-${pad2(dayEnd)}T23:59:59.999-03:00`;
  return { from, to };
}

async function httpGetJson(url, headers = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchRef(url, {
        method: "GET",
        headers,
      });
      const text = await r.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        // se não for JSON, mantém null e joga erro com body
      }
      if (!r.ok) {
        const e = new Error(
          `HTTP ${r.status} ao GET ${url}${
            text ? ` | ${text.slice(0, 400)}` : ""
          }`
        );
        e.statusCode = r.status;
        throw e;
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

async function getMe(accessToken) {
  const url = `https://api.mercadolibre.com/users/me`;
  return httpGetJson(url, { Authorization: `Bearer ${accessToken}` }, 2);
}

function pickOrderDate(order) {
  // Prioriza date_closed (venda “fechada”), fallback date_created
  const d = order?.date_closed || order?.date_created || "";
  return String(d).slice(0, 10); // YYYY-MM-DD
}

function sumOrderUnits(order) {
  const items = order?.order_items || [];
  let units = 0;
  for (const it of items) {
    units += Number(it?.quantity || 0);
  }
  return units;
}

function pickOrderRevenue(order) {
  // Prioriza paid_amount (mais “real”), fallback total_amount
  const v =
    order?.paid_amount ??
    order?.total_amount_with_shipping ??
    order?.total_amount ??
    0;
  return Number(v || 0);
}

async function fetchAllOrdersInRange({
  accessToken,
  sellerId,
  fromIso,
  toIso,
}) {
  // Tenta filtrar por date_closed (melhor). Se falhar (400), cai pra date_created.
  const base = `https://api.mercadolibre.com/orders/search?seller=${encodeURIComponent(
    sellerId
  )}&order.status=paid&limit=50`;

  const tryModes = [
    { fromKey: "order.date_closed.from", toKey: "order.date_closed.to" },
    { fromKey: "order.date_created.from", toKey: "order.date_created.to" },
  ];

  const headers = { Authorization: `Bearer ${accessToken}` };

  let lastErr = null;

  for (const mode of tryModes) {
    try {
      const results = [];
      let offset = 0;
      let total = null;

      while (true) {
        const url =
          `${base}&offset=${offset}` +
          `&${encodeURIComponent(mode.fromKey)}=${encodeURIComponent(
            fromIso
          )}` +
          `&${encodeURIComponent(mode.toKey)}=${encodeURIComponent(toIso)}`;

        const data = await httpGetJson(url, headers, 1);

        const chunk = data?.results || [];
        const paging = data?.paging || {};
        total = Number(paging?.total ?? total ?? 0);

        results.push(...chunk);

        offset += chunk.length;

        if (!chunk.length) break;
        if (total && offset >= total) break;

        // segurança (evita loop infinito em caso de inconsistência)
        if (offset > 5000) break;
      }

      return { modeUsed: mode, orders: results };
    } catch (err) {
      lastErr = err;
      // se for erro de parâmetros, tenta o próximo modo
      if (String(err.message || "").includes("HTTP 400")) continue;
      // se for outro erro (401/403/500), estoura
      throw err;
    }
  }

  throw lastErr || new Error("Falha ao buscar pedidos no período.");
}

function buildEmptyDailySeries(year, month, daysInMonth) {
  const out = [];
  for (let d = 1; d <= daysInMonth; d++) {
    out.push({
      date: `${year}-${pad2(month)}-${pad2(d)}`,
      revenue: 0,
      orders: 0,
      units: 0,
    });
  }
  return out;
}

async function tryGetAdvertiserId(accessToken) {
  // Melhor esforço: tenta endpoint comum de advertisers.
  // Se não rolar (scope), a gente usa env ML_ADS_ADVERTISER_ID como fallback.
  const envId = process.env.ML_ADS_ADVERTISER_ID;
  if (envId) return String(envId);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const candidates = [
    "https://api.mercadolibre.com/advertising/advertisers",
    "https://api.mercadolibre.com/advertising/advertisers/me",
  ];

  for (const url of candidates) {
    try {
      const data = await httpGetJson(url, headers, 0);
      // formatos possíveis: array ou { results: [] } ou { id: ... }
      if (Array.isArray(data) && data[0]?.id) return String(data[0].id);
      if (data?.results?.[0]?.id) return String(data.results[0].id);
      if (data?.id) return String(data.id);
    } catch (_) {
      // ignora
    }
  }
  return null;
}

function normalizeAdsDaily(data, year, month, daysInMonth) {
  // Aceita vários formatos possíveis e tenta extrair: date + direct_amount + total_amount
  const empty = [];
  for (let d = 1; d <= daysInMonth; d++) {
    empty.push({
      date: `${year}-${pad2(month)}-${pad2(d)}`,
      direct_amount: 0,
      total_amount: 0,
    });
  }

  const map = new Map(empty.map((x) => [x.date, x]));

  const rows =
    data?.results ||
    data?.data ||
    data?.metrics ||
    data?.items ||
    data?.daily ||
    [];

  if (Array.isArray(rows)) {
    for (const r of rows) {
      const date = String(r?.date || r?.day || r?.period || "").slice(0, 10);
      if (!date || !map.has(date)) continue;

      const ref = map.get(date);
      const direct = Number(
        r?.direct_amount ?? r?.directAmount ?? r?.revenue ?? r?.sales ?? 0
      );
      const total = Number(r?.total_amount ?? r?.totalAmount ?? 0);

      ref.direct_amount += direct || 0;
      ref.total_amount += total || 0;
    }
  }

  return Array.from(map.values());
}

async function fetchAdsRevenueDaily({
  accessToken,
  advertiserId,
  dateFrom,
  dateTo,
  year,
  month,
  daysInMonth,
}) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Lista de endpoints comuns (melhor esforço — varia por modalidade/versão)
  const endpoints = [
    // Product Ads daily metrics
    `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(
      advertiserId
    )}/product_ads/metrics?date_from=${encodeURIComponent(
      dateFrom
    )}&date_to=${encodeURIComponent(dateTo)}&granularity=day`,
    `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(
      advertiserId
    )}/product_ads/reports?date_from=${encodeURIComponent(
      dateFrom
    )}&date_to=${encodeURIComponent(dateTo)}&granularity=day`,
    // Display/Generic reports (caso conta responda por aqui)
    `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(
      advertiserId
    )}/reports?date_from=${encodeURIComponent(
      dateFrom
    )}&date_to=${encodeURIComponent(dateTo)}&granularity=day`,
  ];

  let lastErr = null;

  for (const url of endpoints) {
    try {
      const data = await httpGetJson(url, headers, 0);
      const daily = normalizeAdsDaily(data, year, month, daysInMonth);

      const directSum = daily.reduce(
        (acc, x) => acc + Number(x.direct_amount || 0),
        0
      );
      const totalSum = daily.reduce(
        (acc, x) => acc + Number(x.total_amount || 0),
        0
      );

      return {
        ok: true,
        endpoint_used: url,
        daily,
        sums: { direct_amount: directSum, total_amount: totalSum },
      };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }

  return {
    ok: false,
    error: lastErr ? lastErr.message || "Ads indisponível" : "Ads indisponível",
    daily: buildEmptyDailySeries(year, month, daysInMonth).map((x) => ({
      date: x.date,
      direct_amount: 0,
      total_amount: 0,
    })),
    sums: { direct_amount: 0, total_amount: 0 },
  };
}

async function getMonthlySales({ accessToken, tz = "America/Sao_Paulo" }) {
  const { year, month, day, daysInMonth } = getNowParts(tz);

  const { from, to } = buildIsoRangeBR({
    year,
    month,
    dayStart: 1,
    dayEnd: daysInMonth,
  });

  const me = await getMe(accessToken);
  const sellerId = me?.id;
  if (!sellerId) {
    const err = new Error("Não foi possível obter o seller_id (users/me).");
    err.statusCode = 400;
    throw err;
  }

  // ORDERS (total / “todas as vendas”)
  const { orders, modeUsed } = await fetchAllOrdersInRange({
    accessToken,
    sellerId,
    fromIso: from,
    toIso: to,
  });

  const daily = buildEmptyDailySeries(year, month, daysInMonth);
  const map = new Map(daily.map((x) => [x.date, x]));

  let revenueTotal = 0;
  let ordersCount = 0;
  let unitsTotal = 0;

  for (const o of orders) {
    // double-check paid
    if (o?.status && String(o.status).toLowerCase() !== "paid") continue;

    const rev = pickOrderRevenue(o);
    const units = sumOrderUnits(o);
    const dstr = pickOrderDate(o);

    revenueTotal += rev;
    ordersCount += 1;
    unitsTotal += units;

    const ref = map.get(dstr);
    if (ref) {
      ref.revenue += rev;
      ref.orders += 1;
      ref.units += units;
    }
  }

  const dayOfMonth = Math.max(1, Number(day || 1));
  const avgDaily = revenueTotal / dayOfMonth;
  const projected = avgDaily * daysInMonth;

  // ADS (best effort)
  const advertiserId = await tryGetAdvertiserId(accessToken);
  let ads = {
    available: false,
    advertiser_id: advertiserId,
    sums: { direct_amount: 0, total_amount: 0 },
    daily: daily.map((x) => ({
      date: x.date,
      direct_amount: 0,
      total_amount: 0,
    })),
    error: "Ads não configurado",
  };

  if (advertiserId) {
    const dateFrom = `${year}-${pad2(month)}-01`;
    const dateTo = `${year}-${pad2(month)}-${pad2(daysInMonth)}`;

    const adsResp = await fetchAdsRevenueDaily({
      accessToken,
      advertiserId,
      dateFrom,
      dateTo,
      year,
      month,
      daysInMonth,
    });

    ads = {
      available: Boolean(adsResp.ok),
      advertiser_id: advertiserId,
      endpoint_used: adsResp.endpoint_used,
      sums: adsResp.sums,
      daily: adsResp.daily,
      error: adsResp.ok ? null : adsResp.error,
    };
  }

  // Orgânico: estimativa (pra ter os 3 números: total, ads e orgânico)
  const adsDirect = Number(ads?.sums?.direct_amount || 0);
  const organicEstimated = Math.max(0, revenueTotal - adsDirect);

  const ticketMedio = ordersCount > 0 ? revenueTotal / ordersCount : 0;

  return {
    period: {
      tz,
      year,
      month,
      day_of_month: dayOfMonth,
      days_in_month: daysInMonth,
      from_iso: from,
      to_iso: to,
      orders_filter_mode: modeUsed, // date_closed ou date_created
    },
    totals: {
      revenue_month_to_date: revenueTotal,
      revenue_projected_month: projected,
      avg_daily_revenue: avgDaily,
      orders_count: ordersCount,
      units_sold: unitsTotal,
      ticket_medio: ticketMedio,
    },
    breakdown: {
      total_all: revenueTotal,
      ads_direct_amount: adsDirect,
      organic_estimated: organicEstimated,
    },
    series: {
      daily_orders: Array.from(map.values()),
    },
    ads,
  };
}

module.exports = {
  getMonthlySales,
};
