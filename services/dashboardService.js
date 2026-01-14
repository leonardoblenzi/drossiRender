"use strict";

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

async function httpGetJson(url, headers = {}) {
  const r = await fetchRef(url, { headers });
  const txt = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} ${txt || ""}`.trim());
    err.statusCode = r.status;
    throw err;
  }
  return txt ? JSON.parse(txt) : {};
}

function brOffsetIso(d) {
  // São Paulo (-03:00). Mantém simples e consistente.
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}T00:00:00.000-03:00`;
}

function getMonthBounds(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1); // exclusivo
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  return { year: y, month: m + 1, start, end, daysInMonth };
}

module.exports = {
  async getSalesMonth({ accessToken }) {
    const { year, month, start, end, daysInMonth } = getMonthBounds(new Date());

    // 1) Descobre seller_id
    const me = await httpGetJson("https://api.mercadolibre.com/users/me", {
      Authorization: `Bearer ${accessToken}`,
    });
    const sellerId = me?.id;
    if (!sellerId) {
      const err = new Error("Não foi possível obter seller_id em /users/me.");
      err.statusCode = 400;
      throw err;
    }

    // 2) Busca pedidos do mês (paginação)
    // OBS: parâmetros podem variar por conta/vertical, então filtramos também client-side.
    const fromIso = brOffsetIso(start);
    const toIso = brOffsetIso(end);

    const dailyTotals = new Array(daysInMonth).fill(0);

    const limit = 50;
    let offset = 0;
    let total = 0;

    while (true) {
      const url =
        `https://api.mercadolibre.com/orders/search` +
        `?seller=${encodeURIComponent(sellerId)}` +
        `&order.date_created.from=${encodeURIComponent(fromIso)}` +
        `&order.date_created.to=${encodeURIComponent(toIso)}` +
        `&limit=${limit}&offset=${offset}`;

      const data = await httpGetJson(url, {
        Authorization: `Bearer ${accessToken}`,
      });

      const results = Array.isArray(data?.results) ? data.results : [];
      total = Number(data?.paging?.total ?? results.length);

      for (const o of results) {
        // ✅ “pagos/confirmados” (robusto): status=paid OU tags contendo "paid"
        const status = String(o?.status || "").toLowerCase();
        const tags = Array.isArray(o?.tags)
          ? o.tags.map((t) => String(t).toLowerCase())
          : [];
        const isPaid = status === "paid" || tags.includes("paid");
        if (!isPaid) continue;

        const dateStr = o?.date_created || o?.date_closed;
        if (!dateStr) continue;
        const dt = new Date(dateStr);
        if (Number.isNaN(dt.getTime())) continue;

        const day = dt.getDate(); // 1..31 (local do navegador/Node)
        if (day < 1 || day > daysInMonth) continue;

        const amount =
          Number(o?.paid_amount ?? NaN) || Number(o?.total_amount ?? NaN) || 0;

        if (isFinite(amount) && amount > 0) {
          dailyTotals[day - 1] += amount;
        }
      }

      offset += results.length;
      if (!results.length || offset >= total) break;
    }

    return {
      year,
      month,
      currency: "BRL",
      daily: dailyTotals.map((amount, idx) => ({ day: idx + 1, amount })),
    };
  },
};
