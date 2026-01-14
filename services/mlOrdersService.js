"use strict";

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

async function httpGetJson(url, headers = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetchRef(url, { headers, cache: "no-store" });
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (!r.ok) {
        const err = new Error(
          `HTTP ${r.status} em ${url} :: ${
            data?.message || data?.error || text || ""
          }`.trim()
        );
        err.statusCode = r.status;
        err.payload = data;
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getMyUserId(accessToken) {
  const url = "https://api.mercadolibre.com/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };
  const data = await httpGetJson(url, headers);
  return data?.id || null;
}

exports.sumPaidOrdersAmount = async ({
  accessToken,
  dateFromISO,
  dateToISO,
}) => {
  const userId = await getMyUserId(accessToken);
  if (!userId) {
    return {
      ok: false,
      reason: "no_user_id",
      total_amount: 0,
      total_orders: 0,
    };
  }

  // orders/search: paginação
  // Observação: filtros podem variar; aqui focamos em status=paid no período.
  // Se tua operação usar "confirmed" também, dá pra expandir.
  const base = new URL("https://api.mercadolibre.com/orders/search");
  base.searchParams.set("seller", String(userId));
  base.searchParams.set("order.status", "paid");
  base.searchParams.set(
    "order.date_created.from",
    `${dateFromISO}T00:00:00.000Z`
  );
  base.searchParams.set("order.date_created.to", `${dateToISO}T23:59:59.999Z`);
  base.searchParams.set("limit", "50");
  base.searchParams.set("offset", "0");

  const headers = { Authorization: `Bearer ${accessToken}` };

  let offset = 0;
  let total = 0;
  let sum = 0;

  while (true) {
    base.searchParams.set("offset", String(offset));
    const data = await httpGetJson(base.toString(), headers);

    const results = data?.results || [];
    const paging = data?.paging || {};
    total = Number(paging.total || 0);

    for (const o of results) {
      const v = Number(o?.total_amount || 0);
      if (!Number.isNaN(v)) sum += v;
    }

    offset += Number(paging.limit || 50);
    if (offset >= total) break;
    if (results.length === 0) break;
  }

  return {
    ok: true,
    seller_id: userId,
    total_amount: sum,
    total_orders: total,
  };
};
