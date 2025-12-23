// services/productAdsService.js
const fetch = require("node-fetch");
const TokenService = require("./tokenService");
const config = require("../config/config");

const SITE_ID = "MLB";
const ITEMS_URL = "https://api.mercadolibre.com/items";

function urls() {
  return {
    advertisers:
      "https://api.mercadolibre.com/advertising/advertisers?product_id=PADS",

    // Search de campanhas (você já usa)
    productAdsCampaignsSearch: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/campaigns/search`,

    // Search de anúncios/itens (você já usa)
    productAdsAdsSearch: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/ads/search`,

    // Detalhe de campanha (nem sempre existe — por isso tem fallback)
    productAdsCampaignDetail: (advId, campaignId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/campaigns/${campaignId}`,

    // Adgroups search (pode variar o path — tentamos 2)
    productAdsAdGroupsSearchA: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/ad_groups/search`,
    productAdsAdGroupsSearchB: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/adgroups/search`,
  };
}

// ======================================================
// Métricas: lista "mínima segura" e lista "expandida"
// ======================================================
const METRICS_MIN = [
  "clicks",
  "prints",
  "ctr",
  "cost",
  "cpc",
  "acos",
  "roas",
  "units_quantity",
  "total_amount",
];

const METRICS_EXTENDED = [
  ...METRICS_MIN,
  "direct_amount",
  "indirect_amount",
  "tacos",
  "organic_units_amount",
];

// ======================================================
// Helper de chamada autenticada
// ======================================================
async function withAuth(url, init, state) {
  const call = async (token) => {
    const headers = {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    return fetch(url, { ...init, headers });
  };

  let resp = await call(state.token);
  if (resp.status !== 401) return resp;

  const novo = await TokenService.renovarToken(state.creds);
  state.token = novo.access_token;

  return call(state.token);
}

async function prepararAuth(opts = {}) {
  const creds = { ...opts.mlCreds, accountKey: opts.accountKey };
  const token = await TokenService.renovarTokenSeNecessario(creds);
  return { token, creds };
}

// ======================================================
// Util: controlar concorrência (evita rate-limit)
// ======================================================
async function pMapLimit(list, limit, mapper) {
  const ret = new Array(list.length);
  let i = 0;

  const workers = new Array(Math.min(limit, list.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= list.length) break;
        ret[idx] = await mapper(list[idx], idx);
      }
    });

  await Promise.all(workers);
  return ret;
}

// ==========================================
// Descobrir advertiser_id da conta
// ==========================================
async function obterAdvertiserId(state) {
  const U = urls();

  const r = await withAuth(
    U.advertisers,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Api-Version": "1",
      },
    },
    state
  );

  const txt = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`advertisers HTTP ${r.status} ${txt}`);
    err.code = "ADVERTISERS_ERROR";
    throw err;
  }

  let data;
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch (e) {
    const err = new Error(`Falha ao parsear advertisers: ${e.message}`);
    err.code = "ADVERTISERS_ERROR";
    throw err;
  }

  const list = Array.isArray(data.advertisers) ? data.advertisers : [];
  if (!list.length) {
    const err = new Error("Nenhum advertiser retornado.");
    err.code = "NO_ADVERTISER";
    throw err;
  }

  const adv = list.find((a) => a.site_id === SITE_ID) || list[0];

  const id = adv.advertiser_id || adv.id;
  if (!id) {
    const err = new Error("Advertiser sem advertiser_id válido.");
    err.code = "NO_ADVERTISER";
    throw err;
  }

  return id;
}

// ==========================================
// Helper: buscar thumbnails (AUTENTICADO)
// ==========================================
async function buscarThumbnailsParaItens(itemIds = [], state) {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  const map = {};
  let logged401 = false;
  const chunkSize = 20;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const slice = uniqueIds.slice(i, i + chunkSize);

    const params = new URLSearchParams();
    params.set("ids", slice.join(","));
    params.set("attributes", "id,thumbnail,secure_thumbnail");

    const url = `${ITEMS_URL}?${params.toString()}`;

    try {
      const r = await withAuth(
        url,
        { method: "GET", headers: { "Content-Type": "application/json" } },
        state
      );

      const txt = await r.text().catch(() => "");

      if (!r.ok) {
        if (r.status === 401 && !logged401) {
          console.warn(
            "[ProductAds] Falha ao buscar thumbnails (401). Verifique permissões do token para /items."
          );
          logged401 = true;
        } else if (r.status !== 401) {
          console.warn(
            "[ProductAds] Falha ao buscar thumbnails:",
            r.status,
            txt
          );
        }
        continue;
      }

      let data;
      try {
        data = txt ? JSON.parse(txt) : [];
      } catch (e) {
        console.warn("[ProductAds] Erro parseando thumbnails:", e.message);
        continue;
      }

      for (const row of data) {
        if (!row || row.code !== 200 || !row.body) continue;
        const body = row.body;
        if (!body.id) continue;

        map[body.id] = body.secure_thumbnail || body.thumbnail || null;
      }
    } catch (e) {
      console.warn(
        "[ProductAds] Erro inesperado ao buscar thumbnails:",
        e.message
      );
    }
  }

  return map;
}

// ======================================================
// Helpers internos de Product Ads
// ======================================================
async function fetchJsonOrError(r) {
  const txt = await r.text().catch(() => "");
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const errData = txt ? JSON.parse(txt) : null;
      if (errData?.error) msg = errData.error;
      if (errData?.message) msg += ` - ${errData.message}`;
      if (!errData?.error && !errData?.message && txt)
        msg = `HTTP ${r.status} ${txt}`;
    } catch (_) {
      if (txt) msg = `HTTP ${r.status} ${txt}`;
    }
    const err = new Error(msg);
    err.httpStatus = r.status;
    err.rawBody = txt;
    throw err;
  }

  try {
    return txt ? JSON.parse(txt) : {};
  } catch (e) {
    const err = new Error(`Parse error: ${e.message}`);
    err.rawBody = txt;
    throw err;
  }
}

function pickCreatedAt(obj) {
  if (!obj) return null;
  return (
    obj.meliCreatedAt || // (o app que você analisou usa isso)
    obj.date_created ||
    obj.dateCreated ||
    obj.created_date ||
    obj.createdDate ||
    obj.created_at ||
    obj.createdAt ||
    null
  );
}

async function tentarAdsSearchComFallback({ state, urlBase, paramsObj }) {
  const doCall = async (metricsList) => {
    const params = new URLSearchParams(paramsObj);
    params.set("metrics", metricsList.join(","));
    const url = `${urlBase}?${params.toString()}`;

    const r = await withAuth(
      url,
      { method: "GET", headers: { "api-version": "2" } },
      state
    );

    return fetchJsonOrError(r);
  };

  try {
    return await doCall(METRICS_EXTENDED);
  } catch (e) {
    console.warn("[ProductAds] metrics fallback (extended -> min):", e.message);
    return await doCall(METRICS_MIN);
  }
}

async function obterCampanhaPorId(advertiserId, campaignId, state) {
  const U = urls();

  // 1) tenta endpoint de detalhe
  try {
    const r = await withAuth(
      U.productAdsCampaignDetail(advertiserId, campaignId),
      { method: "GET", headers: { "api-version": "2" } },
      state
    );
    const data = await fetchJsonOrError(r);
    return data || null;
  } catch (e) {
    // 2) fallback: search filtrando por id (caso detalhe não exista)
    try {
      const paramsObj = {
        limit: "1",
        offset: "0",
        aggregation_type: "campaign",
        "filters[id]": String(campaignId),
      };
      const data = await tentarAdsSearchComFallback({
        state,
        urlBase: U.productAdsCampaignsSearch(advertiserId),
        paramsObj,
      });
      return (data.results || [])[0] || null;
    } catch (e2) {
      return null;
    }
  }
}

async function contarAdgroupsDaCampanha(
  advertiserId,
  campaignId,
  { date_from, date_to } = {},
  state
) {
  const U = urls();

  const tryEndpoint = async (baseUrl) => {
    const params = new URLSearchParams();
    // alguns setups aceitam, outros ignoram — mas não atrapalha
    if (date_from) params.set("date_from", date_from);
    if (date_to) params.set("date_to", date_to);

    params.set("limit", "1");
    params.set("offset", "0");
    params.set("filters[campaign_id]", String(campaignId));

    const url = `${baseUrl}?${params.toString()}`;

    const r = await withAuth(
      url,
      { method: "GET", headers: { "api-version": "2" } },
      state
    );
    const data = await fetchJsonOrError(r);
    const total = data?.paging?.total;
    return typeof total === "number" ? total : null;
  };

  // 1) tenta ad_groups/search (2 variações)
  try {
    const total = await tryEndpoint(U.productAdsAdGroupsSearchA(advertiserId));
    if (typeof total === "number") return total;
  } catch (e) {
    // segue
  }

  try {
    const total = await tryEndpoint(U.productAdsAdGroupsSearchB(advertiserId));
    if (typeof total === "number") return total;
  } catch (e) {
    // segue
  }

  // 2) fallback: ads/search agregando por ad_group (se suportar)
  try {
    const paramsObj = {};
    if (date_from) paramsObj.date_from = date_from;
    if (date_to) paramsObj.date_to = date_to;

    paramsObj.limit = "1";
    paramsObj.offset = "0";
    paramsObj.aggregation_type = "ad_group";
    paramsObj["filters[campaign_id]"] = String(campaignId);

    const data = await tentarAdsSearchComFallback({
      state,
      urlBase: U.productAdsAdsSearch(advertiserId),
      paramsObj,
    });

    const total = data?.paging?.total;
    return typeof total === "number" ? total : null;
  } catch (e) {
    console.warn(
      "[ProductAds] Não consegui contar adgroups (fallback):",
      e.message
    );
    return null;
  }
}

async function listarTodosAdsDaCampanha(
  advertiserId,
  campaignId,
  { date_from, date_to } = {},
  state
) {
  const U = urls();
  const limit = 500;
  let offset = 0;
  let all = [];
  let total = null;

  while (true) {
    const paramsObj = {};
    if (date_from) paramsObj.date_from = date_from;
    if (date_to) paramsObj.date_to = date_to;
    paramsObj.metrics_summary = "true";
    paramsObj.aggregation_type = "item";
    paramsObj.limit = String(limit);
    paramsObj.offset = String(offset);
    paramsObj["filters[campaign_id]"] = String(campaignId);

    const data = await tentarAdsSearchComFallback({
      state,
      urlBase: U.productAdsAdsSearch(advertiserId),
      paramsObj,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    const paging = data.paging || {};
    total = typeof paging.total === "number" ? paging.total : total;

    all.push(...results);

    offset += results.length;
    if (!results.length) break;

    if (typeof total === "number" && offset >= total) break;
    if (results.length < limit) break;
  }

  return all;
}

class ProductAdsService {
  // ======================================================
  // LISTAR CAMPANHAS (agregado por campanha)
  // Agora inclui: created_at + adgroups_count
  // ======================================================
  static async listarCampanhas({ date_from, date_to } = {}, options = {}) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      const paramsObj = {};
      if (date_from) paramsObj.date_from = date_from;
      if (date_to) paramsObj.date_to = date_to;
      paramsObj.limit = "200";
      paramsObj.offset = "0";
      paramsObj.aggregation_type = "campaign";

      const data = await tentarAdsSearchComFallback({
        state,
        urlBase: U.productAdsCampaignsSearch(advertiserId),
        paramsObj,
      });

      const baseCampaigns = (data.results || []).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        strategy: c.strategy,
        acos_target: c.acos_target,
        roas: c.roas,
        // tenta pegar direto do search (se vier)
        created_at: pickCreatedAt(c),
        metrics: c.metrics || {},
        adgroups_count: null,
      }));

      // Preenche created_at (se faltar) e adgroups_count
      const enriched = await pMapLimit(baseCampaigns, 5, async (c) => {
        let created_at = c.created_at;

        if (!created_at) {
          const detail = await obterCampanhaPorId(advertiserId, c.id, state);
          created_at = pickCreatedAt(detail) || null;
        }

        const adgroups_count = await contarAdgroupsDaCampanha(
          advertiserId,
          c.id,
          { date_from, date_to },
          state
        );

        return {
          ...c,
          created_at,
          adgroups_count,
        };
      });

      return {
        success: true,
        date_from,
        date_to,
        campaigns: enriched,
        paging: data.paging || {},
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || "CAMPAIGNS_ERROR",
      };
    }
  }

  // ======================================================
  // LISTAR ITENS DA CAMPANHA (ads) COM MÉTRICAS + THUMB
  // ======================================================
  static async listarItensCampanha(
    campaignId,
    { date_from, date_to } = {},
    options = {}
  ) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      // ======================================================
      // 1) Busca métrica dos ADS (OFICIAL: Advertising Product Ads)
      // ======================================================
      const paramsObj = {};
      if (date_from) paramsObj.date_from = date_from;
      if (date_to) paramsObj.date_to = date_to;
      paramsObj.metrics_summary = "true";
      paramsObj.aggregation_type = "item";
      paramsObj.limit = "500";
      paramsObj.offset = "0";
      paramsObj["filters[campaign_id]"] = String(campaignId);

      const data = await tentarAdsSearchComFallback({
        state,
        urlBase: U.productAdsAdsSearch(advertiserId),
        paramsObj,
      });

      let items = (data.results || []).map((it) => {
        const metrics = it.metrics || {};
        const clicks = Number(metrics.clicks ?? 0);
        const units = Number(metrics.units_quantity ?? 0);

        const conversion_rate = clicks > 0 ? units / clicks : null;

        return {
          item_id: it.item_id,
          title: it.title,
          sku: it.sku || null, // se vier do ads/search (geralmente não vem)
          status: it.status,
          cpc: it.cpc,
          ad_group_id: it.ad_group_id || it.adgroup_id || it.adGroupId || null,

          // NOVO (vai preencher depois):
          publication_quality: null, // 0..100
          thumbnail: null,

          metrics: {
            ...metrics,
            conversion_rate,
          },
        };
      });

      // ======================================================
      // 2) Enriquecimento via Items API (OFICIAL)
      //    - thumbnail / secure_thumbnail
      //    - seller_custom_field (SKU interno do seller)
      //    - attributes (fallback p/ SKU)
      //    - health (qualidade) quando disponível
      // ======================================================
      const normalizeQualityToPct = (raw) => {
        if (raw == null) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;

        // Alguns retornos são 0..1, outros podem ser 0..100
        if (n >= 0 && n <= 1) return Math.round(n * 100);
        if (n >= 0 && n <= 100) return Math.round(n);
        return null;
      };

      const extractSkuFromItemBody = (body) => {
        // 1) seller_custom_field (mais comum)
        if (body?.seller_custom_field) return String(body.seller_custom_field);

        // 2) attributes[] (quando existe SELLER_SKU)
        const attrs = Array.isArray(body?.attributes) ? body.attributes : [];
        const cand =
          attrs.find(
            (a) => String(a?.id || "").toUpperCase() === "SELLER_SKU"
          ) ||
          attrs.find((a) => String(a?.id || "").toUpperCase() === "SKU") ||
          null;

        const v =
          cand?.value_name ??
          cand?.value_id ??
          (Array.isArray(cand?.values) && cand.values[0]?.name) ??
          null;

        return v != null && String(v).trim() ? String(v).trim() : null;
      };

      const enrichFromItemsApi = async (itemIds) => {
        const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
        if (!uniqueIds.length) return new Map();

        const out = new Map();
        const chunkSize = 20; // mantém seu padrão (URL curta e segura)

        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
          const slice = uniqueIds.slice(i, i + chunkSize);

          const params = new URLSearchParams();
          params.set("ids", slice.join(","));
          // pede o que precisamos
          params.set(
            "attributes",
            [
              "id",
              "title",
              "thumbnail",
              "secure_thumbnail",
              "seller_custom_field",
              "attributes",
              "health",
            ].join(",")
          );

          const url = `${ITEMS_URL}?${params.toString()}`;

          const r = await withAuth(
            url,
            {
              method: "GET",
              headers: { "Content-Type": "application/json" },
            },
            state
          );

          const txt = await r.text().catch(() => "");
          if (!r.ok) {
            console.warn("[ProductAds] Items API falhou:", r.status, txt);
            continue;
          }

          let rows;
          try {
            rows = txt ? JSON.parse(txt) : [];
          } catch (e) {
            console.warn("[ProductAds] Items API parse error:", e.message);
            continue;
          }

          // formato típico: [{ code:200, body:{...}}, ...]
          for (const row of rows) {
            if (!row || row.code !== 200 || !row.body?.id) continue;
            const body = row.body;

            const id = String(body.id);
            const thumb = body.secure_thumbnail || body.thumbnail || null;
            const sku = extractSkuFromItemBody(body);

            const quality =
              normalizeQualityToPct(body.health) ??
              normalizeQualityToPct(body.quality) ??
              null;

            out.set(id, {
              thumbnail: thumb,
              sku,
              publication_quality: quality,
            });
          }
        }

        return out;
      };

      // ======================================================
      // 3) Fallback oficial p/ qualidade: /items/{id}/health
      //    (só pros que não vieram no batch)
      // ======================================================
      const fetchItemHealth = async (itemId) => {
        const url = `${ITEMS_URL}/${encodeURIComponent(itemId)}/health`;

        try {
          const r = await withAuth(
            url,
            {
              method: "GET",
              headers: { "Content-Type": "application/json" },
            },
            state
          );

          const txt = await r.text().catch(() => "");
          if (!r.ok) return null;

          let data;
          try {
            data = txt ? JSON.parse(txt) : {};
          } catch (_) {
            return null;
          }

          // Já vi retornos tipo { health: 0.85 } ou { value: 0.85 }
          const raw =
            data?.health ??
            data?.value ??
            data?.item_health ??
            data?.result ??
            null;

          return normalizeQualityToPct(raw);
        } catch (_) {
          return null;
        }
      };

      // ======================================================
      // 4) Aplica enrich + fallback health
      // ======================================================
      const ids = items.map((i) => i.item_id).filter(Boolean);
      const enrichMap = await enrichFromItemsApi(ids);

      items = items.map((it) => {
        const e = enrichMap.get(String(it.item_id));
        if (!e) return it;
        return {
          ...it,
          thumbnail: e.thumbnail ?? it.thumbnail ?? null,
          sku: e.sku ?? it.sku ?? null,
          publication_quality:
            e.publication_quality ?? it.publication_quality ?? null,
        };
      });

      // fallback health por item (só quando não veio)
      const needHealth = items
        .filter(
          (it) =>
            it.item_id &&
            (it.publication_quality == null ||
              !Number.isFinite(Number(it.publication_quality)))
        )
        .map((it) => String(it.item_id));

      if (needHealth.length) {
        // concorrência baixa pra não estourar rate-limit
        const healthMap = new Map();

        await pMapLimit(needHealth, 6, async (id) => {
          const q = await fetchItemHealth(id);
          if (q != null) healthMap.set(id, q);
        });

        items = items.map((it) => {
          const q = healthMap.get(String(it.item_id));
          if (q == null) return it;
          return { ...it, publication_quality: q };
        });
      }

      // Se você quiser que o front use it.health diretamente,
      // basta duplicar:
      items = items.map((it) => ({
        ...it,
        health: it.publication_quality, // compatível com seu detectQuality(it)
      }));

      return {
        success: true,
        campaign_id: campaignId,
        date_from,
        date_to,
        items,
        paging: data.paging || {},
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || "ITEMS_ERROR",
      };
    }
  }

  // ======================================================
  // MÉTRICAS DIÁRIAS (para o gráfico)
  // ======================================================
  static async metricasDiarias({ date_from, date_to } = {}, options = {}) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      const params = new URLSearchParams();
      if (date_from) params.set("date_from", date_from);
      if (date_to) params.set("date_to", date_to);

      params.set(
        "metrics",
        ["clicks", "prints", "cost", "total_amount"].join(",")
      );
      params.set("aggregation_type", "DAILY");
      params.set("limit", "200");

      const url = `${U.productAdsCampaignsSearch(
        advertiserId
      )}?${params.toString()}`;

      const r = await withAuth(
        url,
        { method: "GET", headers: { "api-version": "2" } },
        state
      );

      const data = await fetchJsonOrError(r);

      const series = (data.results || []).map((row) => ({
        date: row.date,
        clicks: row.clicks || 0,
        prints: row.prints || 0,
        cost: row.cost || 0,
        total_amount: row.total_amount || 0,
      }));

      return { success: true, date_from, date_to, series };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || "METRICS_ERROR",
      };
    }
  }

  // ======================================================
  // EXPORTAR CSV (mlb, campanha)
  // ======================================================
  static async exportarItensCampanhaCsv(
    campaignId,
    { date_from, date_to } = {},
    options = {}
  ) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);

      let campaignName = "";
      const detail = await obterCampanhaPorId(advertiserId, campaignId, state);
      campaignName = detail?.name || "";

      const allAds = await listarTodosAdsDaCampanha(
        advertiserId,
        campaignId,
        { date_from, date_to },
        state
      );

      const rows = [["mlb", "campanha"]];
      for (const ad of allAds) {
        const mlb = ad.item_id || "";
        rows.push([mlb, campaignName || String(campaignId)]);
      }

      const csv = rows
        .map((cols) =>
          cols
            .map((v) => {
              const s = String(v ?? "");
              return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(",")
        )
        .join("\n");

      return { success: true, csv, filename: `campanha_${campaignId}.csv` };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || "ITEMS_ERROR",
      };
    }
  }
}

module.exports = ProductAdsService;
