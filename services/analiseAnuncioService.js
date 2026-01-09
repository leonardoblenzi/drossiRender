// services/analiseAnuncioService.js
"use strict";

const BASE = "https://api.mercadolibre.com";

// Node 18+ tem fetch global; fallback pra node-fetch
const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function datePart(d) {
  // YYYY-MM-DD (UTC)
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanZip(zip) {
  const z = String(zip || "").replace(/\D/g, "");
  // CEP BR: 8 dígitos
  if (z.length !== 8) return null;
  return z;
}

function inferPremium(listing_type_id) {
  const id = String(listing_type_id || "").toLowerCase();
  // Brasil normalmente: gold_pro = Premium; gold_special = Clássico
  return id === "gold_pro" || id === "gold_premium";
}

function pickSellerLocation(user) {
  const city =
    user?.address?.city || user?.address?.city_name || user?.city_name || null;

  const state =
    user?.address?.state ||
    user?.address?.state_name ||
    user?.state_name ||
    null;

  if (city && state) return `${city}/${state}`;
  if (city) return String(city);
  if (state) return String(state);
  return null;
}

async function mlGet(path, accessToken, qs = {}, retries = 3) {
  const url = new URL(BASE + path);

  Object.entries(qs || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    url.searchParams.set(k, String(v));
  });

  let lastErr;

  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetchRef(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const isJson = ct.includes("application/json");
      const body = isJson
        ? await r.json().catch(() => null)
        : await r.text().catch(() => "");

      if (!r.ok) {
        const err = new Error(
          (body && (body.message || body.error || body.cause)) ||
            `HTTP ${r.status} em ${path}`
        );
        err.statusCode = r.status;

        if (r.status === 429 || r.status >= 500) {
          lastErr = err;
          await sleep(250 * (i + 1));
          continue;
        }
        throw err;
      }

      return body;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await sleep(250 * (i + 1));
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr || new Error("Falha ao chamar ML API");
}

async function getVisits({ mlb, accessToken, dateFrom, dateTo }) {
  const attempts = [
    () =>
      mlGet(
        `/items/${encodeURIComponent(mlb)}/visits`,
        accessToken,
        { date_from: dateFrom, date_to: dateTo },
        2
      ),
    () =>
      mlGet(
        `/visits/items`,
        accessToken,
        { ids: mlb, date_from: dateFrom, date_to: dateTo },
        2
      ),
    () => mlGet(`/visits/items`, accessToken, { ids: mlb }, 2),
  ];

  for (const fn of attempts) {
    try {
      const v = await fn();

      if (v && typeof v.total_visits === "number") {
        return { total: v.total_visits, raw: v };
      }

      if (v && typeof v === "object" && v[mlb] != null) {
        const vv = v[mlb];
        if (typeof vv === "number") return { total: vv, raw: v };
        if (vv && typeof vv.total_visits === "number")
          return { total: vv.total_visits, raw: v };
      }

      if (Array.isArray(v)) {
        const row = v.find((x) => x && (x.id === mlb || x.item_id === mlb));
        if (row) {
          const n = row.total_visits ?? row.visits ?? row.total ?? null;
          if (typeof n === "number") return { total: n, raw: v };
        }
      }

      return { total: null, raw: v };
    } catch (_e) {}
  }

  return { total: null, raw: null };
}

async function getShipping({ mlb, accessToken, zip_code, item }) {
  const cleaned = cleanZip(zip_code);
  const base = {
    zip_code: cleaned,
    free_shipping: item?.shipping?.free_shipping ?? null,
    cost: null,
    logistic_type: item?.shipping?.logistic_type ?? null,
    mode: item?.shipping?.mode ?? null,
    raw: null,
  };

  if (!cleaned) return base;

  const attempts = [
    () =>
      mlGet(
        `/items/${encodeURIComponent(mlb)}/shipping_options`,
        accessToken,
        { zip_code: cleaned },
        2
      ),
    () =>
      mlGet(
        `/items/${encodeURIComponent(mlb)}/shipping_options/free`,
        accessToken,
        { zip_code: cleaned },
        2
      ),
  ];

  for (const fn of attempts) {
    try {
      const sh = await fn();
      base.raw = sh;

      const options =
        sh?.options ||
        sh?.shipping_options ||
        sh?.available_shipping_options ||
        null;

      if (Array.isArray(options) && options.length) {
        const costs = options
          .map((o) => Number(o?.cost ?? o?.list_cost ?? o?.base_cost))
          .filter((n) => Number.isFinite(n));

        if (costs.length) {
          const min = Math.min(...costs);
          base.cost = min;
          if (min === 0) base.free_shipping = true;
        }
      }

      return base;
    } catch (_e) {}
  }

  return base;
}

module.exports = {
  async getOverview({ mlb, accessToken, days = 30, zip_code = null }) {
    const now = new Date();
    const dateTo = datePart(now);
    const from = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000);
    const dateFrom = datePart(from);

    // 1) Item (principal)
    const item = await mlGet(
      `/items/${encodeURIComponent(mlb)}`,
      accessToken,
      {},
      3
    );

    // ✅ IMAGENS GRANDES (pra não ficar borrado)
    // pictures costuma vir com secure_url grande
    const pictures = Array.isArray(item?.pictures)
      ? item.pictures.map((p) => p?.secure_url || p?.url).filter(Boolean)
      : [];

    // 2) Seller
    const sellerId = item?.seller_id;
    let seller = null;

    if (sellerId) {
      seller = await mlGet(
        `/users/${encodeURIComponent(sellerId)}`,
        accessToken,
        {},
        3
      );
    }

    // 3) Visits (janela)
    const visits = await getVisits({ mlb, accessToken, dateFrom, dateTo });

    // 4) Shipping (se tiver CEP)
    const shipping = await getShipping({ mlb, accessToken, zip_code, item });

    // Resumo no formato que seu analise-ia.js renderiza
    const summary = {
      id: item?.id,
      title: item?.title,
      status: item?.status,
      permalink: item?.permalink,
      category_id: item?.category_id,
      condition: item?.condition,
      currency_id: item?.currency_id,

      price: item?.price ?? null,
      available_quantity: item?.available_quantity ?? null,
      sold_quantity: item?.sold_quantity ?? null,

      listing_type_id: item?.listing_type_id ?? null,
      catalog_listing: item?.catalog_listing ?? null,
      is_premium: inferPremium(item?.listing_type_id),

      date_created: item?.date_created ?? null,
      last_updated: item?.last_updated ?? null,

      // ✅ prioridade pra imagem grande
      thumbnail:
        pictures[0] || item?.thumbnail || item?.secure_thumbnail || null,
      pictures,
    };

    const sellerOut = seller
      ? {
          seller_id: seller?.id ?? sellerId ?? null,
          nickname: seller?.nickname ?? null,
          location: pickSellerLocation(seller),
        }
      : { seller_id: sellerId ?? null, nickname: null, location: null };

    const sellerRep = seller?.seller_reputation || null;

    return {
      summary,
      visits: {
        total: visits.total,
        date_from: dateFrom,
        date_to: dateTo,
      },
      shipping: {
        zip_code: shipping.zip_code,
        free_shipping: shipping.free_shipping,
        cost: shipping.cost,
        logistic_type: shipping.logistic_type,
        mode: shipping.mode,
      },
      seller: sellerOut,
      seller_reputation: sellerRep,
      meta: {
        fetched_at: new Date().toISOString(),
      },
      raw: {
        item,
        seller,
        visits: visits.raw,
        shipping: shipping.raw,
      },
    };
  },
};
