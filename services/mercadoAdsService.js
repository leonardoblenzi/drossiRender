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

function headersAds(accessToken) {
  // Muitos exemplos dos endpoints Ads pedem Api-Version: 1 :contentReference[oaicite:3]{index=3}
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Api-Version": "1",
  };
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return 0;
}

async function listAdvertisers({ accessToken, productId = "PADS" }) {
  // Exemplo público: /advertising/advertisers?product_id=$PRODUCT_ID :contentReference[oaicite:4]{index=4}
  const url = new URL("https://api.mercadolibre.com/advertising/advertisers");
  url.searchParams.set("product_id", productId);

  const data = await httpGetJson(url.toString(), headersAds(accessToken));

  // Pode vir como array direto, ou { results: [...] }
  const arr = Array.isArray(data)
    ? data
    : data?.results || data?.advertisers || [];
  return Array.isArray(arr) ? arr : [];
}

async function fetchCampaignsWithMetrics({
  accessToken,
  advertiserId,
  siteId,
  dateFromISO,
  dateToISO,
}) {
  const metrics = "amount_total,cost,clicks,impressions";

  // Existem variações públicas de path (com site_id e com /search). :contentReference[oaicite:5]{index=5}
  const candidates = [];

  if (siteId) {
    candidates.push(
      `https://api.mercadolibre.com/advertising/${siteId}/advertisers/${advertiserId}/product_ads/campaigns/search`
    );
    candidates.push(
      `https://api.mercadolibre.com/advertising/${siteId}/advertisers/${advertiserId}/product_ads/campaigns`
    );
  }
  candidates.push(
    `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/campaigns/search`
  );
  candidates.push(
    `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/campaigns`
  );

  let lastError = null;

  for (const baseUrl of candidates) {
    try {
      // paginação
      let offset = 0;
      let total = 0;

      let sumAmount = 0;
      let sumCost = 0;
      let sumClicks = 0;
      let sumImpr = 0;
      let count = 0;

      while (true) {
        const url = new URL(baseUrl);
        url.searchParams.set("limit", "50");
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("date_from", dateFromISO);
        url.searchParams.set("date_to", dateToISO);
        url.searchParams.set("metrics", metrics);

        const data = await httpGetJson(url.toString(), headersAds(accessToken));

        const results =
          data?.results || data?.campaigns || (Array.isArray(data) ? data : []);
        const paging = data?.paging || {};
        total = Number(paging.total || 0);

        for (const c of results) {
          const m = c?.metrics || c?.metricas || c?.metrics_data || {};
          sumAmount += pickNumber(m, [
            "amount_total",
            "amountTotal",
            "amount",
            "revenue",
            "gmv",
          ]);
          sumCost += pickNumber(m, ["cost", "spend"]);
          sumClicks += pickNumber(m, ["clicks"]);
          sumImpr += pickNumber(m, ["impressions"]);
          count++;
        }

        offset += Number(paging.limit || 50);

        // Se não tiver paging, para quando vier vazio
        if (!paging.total && (!results || results.length === 0)) break;

        if (paging.total && offset >= total) break;
        if (!results || results.length === 0) break;
      }

      return {
        ok: true,
        endpoint_used: baseUrl,
        campaigns_count: count,
        metrics: {
          amount_total: sumAmount,
          cost: sumCost,
          clicks: sumClicks,
          impressions: sumImpr,
        },
      };
    } catch (e) {
      lastError = e;
      // tenta o próximo path em caso de 404 / mismatch
      continue;
    }
  }

  // Se nada funcionou:
  const status = lastError?.statusCode || 500;
  const msg = lastError?.message || "Falha ao consultar Mercado Ads.";

  let reason = "unknown";
  if (status === 401) reason = "unauthorized";
  if (status === 403) reason = "forbidden";
  if (status === 404) reason = "not_found";

  return {
    ok: false,
    reason,
    status,
    message: msg,
  };
}

exports.getProductAdsAttributedRevenue = async ({
  accessToken,
  dateFromISO,
  dateToISO,
  preferSiteId = "MLB",
}) => {
  try {
    const advertisers = await listAdvertisers({
      accessToken,
      productId: "PADS",
    });

    if (!advertisers || advertisers.length === 0) {
      return {
        ok: false,
        reason: "no_advertiser",
        message: "Nenhum advertiser encontrado para PADS (Product Ads).",
      };
    }

    // tenta escolher o advertiser do Brasil (MLB), senão pega o primeiro
    const chosen =
      advertisers.find(
        (a) =>
          String(a?.site_id || a?.siteId || "").toUpperCase() === preferSiteId
      ) || advertisers[0];

    const advertiserId =
      chosen?.advertiser_id || chosen?.advertiserId || chosen?.id;
    const siteId = chosen?.site_id || chosen?.siteId;

    if (!advertiserId) {
      return {
        ok: false,
        reason: "no_advertiser_id",
        message: "Advertiser encontrado, mas sem advertiser_id.",
        advertiser: chosen,
      };
    }

    const metricsResp = await fetchCampaignsWithMetrics({
      accessToken,
      advertiserId,
      siteId,
      dateFromISO,
      dateToISO,
    });

    return {
      advertiser: {
        advertiser_id: advertiserId,
        site_id: siteId || null,
      },
      ...metricsResp,
    };
  } catch (e) {
    const status = e?.statusCode || 500;
    return {
      ok: false,
      reason:
        status === 401
          ? "unauthorized"
          : status === 403
          ? "forbidden"
          : "unknown",
      status,
      message: e?.message || String(e),
    };
  }
};
