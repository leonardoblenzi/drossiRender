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

/**
 * ✅ FEES UNITÁRIO (Imposto/Recebe por 1 venda)
 * Endpoint oficial:
 *   /sites/{site_id}/listing_prices?price=...&listing_type_id=...&category_id=...
 *
 * Retorna valores tipo:
 *   sale_fee_amount, listing_fee_amount, etc
 */
async function getUnitFees({ accessToken, siteId, price, categoryId, listingTypeId }) {
  if (!siteId || !price || !categoryId || !listingTypeId) return { ok: false, raw: null };

  const attempts = [
    () =>
      mlGet(
        `/sites/${encodeURIComponent(siteId)}/listing_prices`,
        accessToken,
        {
          price: Number(price),
          category_id: categoryId,
          listing_type_id: listingTypeId,
        },
        2
      ),
  ];

  for (const fn of attempts) {
    try {
      const resp = await fn();
      const row =
        Array.isArray(resp?.listing_prices) && resp.listing_prices.length
          ? resp.listing_prices[0]
          : Array.isArray(resp) && resp.length
            ? resp[0]
            : resp;

      // tenta extrair padrões comuns
      const saleFee = Number(row?.sale_fee_amount);
      const listFee = Number(row?.listing_fee_amount);

      const sale_fee_amount = Number.isFinite(saleFee) ? saleFee : 0;
      const listing_fee_amount = Number.isFinite(listFee) ? listFee : 0;

      const total_fee = sale_fee_amount + listing_fee_amount;
      const net_receive = Number(price) - total_fee;

      return {
        ok: true,
        sale_fee_amount,
        listing_fee_amount,
        total_fee,
        net_receive: Number.isFinite(net_receive) ? net_receive : null,
        raw: resp,
      };
    } catch (_e) {}
  }

  return { ok: false, raw: null };
}

/**
 * ✅ ÚLTIMA VENDA (data/hora da venda mais recente do anúncio)
 * Precisa Orders:
 *   /orders/search?seller=...&item=...&sort=date_desc&limit=...
 *
 * A gente tenta filtrar por status pago/confirmado, mas se o filtro não pegar
 * (varia um pouco), a gente busca e escolhe o primeiro "paid/confirmed".
 */
async function getLastSale({ accessToken, sellerId, mlb }) {
  if (!sellerId || !mlb) return { last_sale_at: null, order: null, raw: null };

  const baseQs = {
    seller: sellerId,
    item: mlb,
    sort: "date_desc",
    limit: 10,
  };

  const attempts = [
    // tenta filtros comuns
    () => mlGet(`/orders/search`, accessToken, { ...baseQs, "order.status": "paid" }, 2),
    () => mlGet(`/orders/search`, accessToken, { ...baseQs, "order.status": "confirmed" }, 2),
    () => mlGet(`/orders/search`, accessToken, { ...baseQs, "order.status": "paid,confirmed" }, 2),
    // fallback sem filtro
    () => mlGet(`/orders/search`, accessToken, { ...baseQs }, 2),
  ];

  for (const fn of attempts) {
    try {
      const resp = await fn();

      const results =
        resp?.results ||
        resp?.orders ||
        (Array.isArray(resp) ? resp : null);

      if (!Array.isArray(results) || !results.length) {
        return { last_sale_at: null, order: null, raw: resp };
      }

      const pick = (o) => {
        const status = String(o?.status || "").toLowerCase();
        return status === "paid" || status === "confirmed";
      };

      const order = results.find(pick) || results[0];

      const dt =
        order?.date_closed ||
        order?.date_created ||
        order?.date_last_updated ||
        null;

      return {
        last_sale_at: dt || null,
        order: order
          ? {
              id: order.id ?? null,
              status: order.status ?? null,
              date: dt || null,
            }
          : null,
        raw: resp,
      };
    } catch (_e) {}
  }

  return { last_sale_at: null, order: null, raw: null };
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

    // 5) ✅ Fees unitário (Imposto/Recebe por 1 venda)
    const siteId = item?.site_id || "MLB";
    const feesUnit = await getUnitFees({
      accessToken,
      siteId,
      price: item?.price,
      categoryId: item?.category_id,
      listingTypeId: item?.listing_type_id,
    });

    // 6) ✅ Última venda (Orders)
    const lastSale = await getLastSale({ accessToken, sellerId, mlb });

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

      // ✅ oficial store id vem do item
      official_store_id: item?.official_store_id ?? null,

      date_created: item?.date_created ?? null,
      last_updated: item?.last_updated ?? null,

      thumbnail: pictures[0] || item?.thumbnail || item?.secure_thumbnail || null,
      pictures,
    };

    const sellerOut = seller
      ? {
          seller_id: seller?.id ?? sellerId ?? null,
          nickname: seller?.nickname ?? null,
          location: pickSellerLocation(seller),
          // ✅ útil pro pill "Loja oficial" no front
          official_store: seller?.official_store ?? null,
        }
      : { seller_id: sellerId ?? null, nickname: null, location: null, official_store: null };

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

      // ✅ NOVO: métricas pra preencher os cards faltando
      metrics: {
        unit: feesUnit?.ok
          ? {
              // “Imposto” = total de fee estimado do ML (por 1 venda)
              tax: feesUnit.total_fee,
              // “Recebe” = preço - fees (por 1 venda)
              receives: feesUnit.net_receive,
              // extras úteis
              sale_fee_amount: feesUnit.sale_fee_amount,
              listing_fee_amount: feesUnit.listing_fee_amount,
              currency_id: item?.currency_id || "BRL",
            }
          : {
              tax: null,
              receives: null,
              sale_fee_amount: null,
              listing_fee_amount: null,
              currency_id: item?.currency_id || "BRL",
            },

        // “Última venda”
        last_sale_at: lastSale.last_sale_at,
      },

      meta: {
        fetched_at: new Date().toISOString(),
      },
      raw: {
        item,
        seller,
        visits: visits.raw,
        shipping: shipping.raw,
        fees_unit: feesUnit.raw,
        last_sale: lastSale.raw,
      },
    };
  },
};
