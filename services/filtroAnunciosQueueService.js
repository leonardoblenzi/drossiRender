// services/filtroAnunciosQueueService.js
"use strict";

const Bull = require("bull");
const { makeRedis } = require("../lib/redisClient");
const fs = require("fs").promises;
const path = require("path");

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const upper = (v) =>
  String(v || "")
    .trim()
    .toUpperCase();
const datePart = (iso) => String(iso || "").slice(0, 10); // YYYY-MM-DD

async function httpGetJson(url, headers = {}, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetchRef(url, { headers });
      const status = r.status;
      const text = await r.text();

      if (status === 429 || (status >= 500 && status < 600)) {
        await sleep(400 * (i + 1));
        continue;
      }
      if (!r.ok)
        throw new Error(`GET ${url} -> ${status} :: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } catch (e) {
      last = e;
      await sleep(250 * (i + 1));
    }
  }
  throw last || new Error("httpGetJson failed");
}

async function getSellerId(token) {
  const j = await httpGetJson(
    "https://api.mercadolibre.com/users/me",
    {
      Authorization: `Bearer ${token}`,
    },
    3
  );
  return j.id;
}

// SCAN recomendado (sem offset). Fallback: paginação normal até offset <= 1000.
async function fetchAllItemIds({ token, sellerId, status }) {
  try {
    let scrollId = null;
    const all = [];

    for (;;) {
      const url = new URL(
        `https://api.mercadolibre.com/users/${sellerId}/items/search`
      );
      url.searchParams.set("status", status);
      url.searchParams.set("search_type", "scan");
      url.searchParams.set("limit", "50");
      if (scrollId) url.searchParams.set("scroll_id", scrollId);

      const j = await httpGetJson(
        url.toString(),
        { Authorization: `Bearer ${token}` },
        3
      );

      const results = Array.isArray(j?.results) ? j.results : [];
      all.push(...results);

      scrollId = j?.scroll_id || null;
      if (!scrollId || results.length === 0) break;
    }

    return Array.from(new Set(all.map((x) => upper(x))));
  } catch {
    const all = [];
    let offset = 0;
    const limit = 50;

    for (;;) {
      const url = new URL(
        `https://api.mercadolibre.com/users/${sellerId}/items/search`
      );
      url.searchParams.set("status", status);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const j = await httpGetJson(
        url.toString(),
        { Authorization: `Bearer ${token}` },
        3
      );

      const results = Array.isArray(j?.results) ? j.results : [];
      all.push(...results);

      offset += limit;
      if (offset > 1000) break;
      const total = Number(j?.paging?.total || 0);
      if (!total || offset >= total) break;
    }

    return Array.from(new Set(all.map((x) => upper(x))));
  }
}

function mapTipo(listingTypeId) {
  const id = String(listingTypeId || "").toLowerCase();
  if (id === "gold_pro" || id === "gold_premium") return "Premium";
  if (id === "gold_special") return "Clássico";
  return id || "—";
}
function mapEnvio(shipping) {
  const free = !!shipping?.free_shipping;
  return free ? "Frete grátis" : "Por conta do comprador";
}
function mapDetalhes(item) {
  const isCatalog = !!item?.catalog_listing;
  return isCatalog ? "Catálogo" : "Normal";
}

async function fetchItemsBatch({ token, ids }) {
  const url = new URL("https://api.mercadolibre.com/items");
  url.searchParams.set("ids", ids.join(","));
  const j = await httpGetJson(
    url.toString(),
    { Authorization: `Bearer ${token}` },
    3
  );
  const arr = Array.isArray(j) ? j : [];
  return arr
    .filter((x) => x && x.code === 200 && x.body && x.body.id)
    .map((x) => x.body);
}

/**
 * Vendas agregadas "por anúncio".
 * Se o order item vier num id "filho", e a gente souber o parent via itemToParent, agrega no pai.
 */
async function fetchSalesMap({
  token,
  sellerId,
  date_from,
  date_to,
  itemToParent = null,
}) {
  let offset = 0;
  const limit = 50;
  const out = new Map();

  for (;;) {
    const url = new URL("https://api.mercadolibre.com/orders/search");
    url.searchParams.set("seller", String(sellerId));
    url.searchParams.set("order.status", "paid");
    url.searchParams.set(
      "order.date_created.from",
      `${date_from}T00:00:00.000-00:00`
    );
    url.searchParams.set(
      "order.date_created.to",
      `${date_to}T23:59:59.999-00:00`
    );
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const j = await httpGetJson(
      url.toString(),
      { Authorization: `Bearer ${token}` },
      3
    );
    const results = Array.isArray(j?.results) ? j.results : [];

    for (const order of results) {
      for (const it of order.order_items || []) {
        const rawId = upper(it?.item?.id);
        if (!rawId) continue;

        const mlb = itemToParent?.get(rawId) || rawId; // <- agrupa no pai quando existir

        const qty = Number(it?.quantity || 0);
        const unit = Number(it?.unit_price || 0);
        const revenue = unit * qty;

        const prev = out.get(mlb) || { units: 0, revenue_cents: 0 };
        prev.units += qty;
        prev.revenue_cents += Math.round(revenue * 100);
        out.set(mlb, prev);
      }
    }

    offset += limit;
    const total = Number(j?.paging?.total || 0);
    if (!total || offset >= total) break;
  }

  return out;
}

// ✅ NOVO: vendas após o período (date_to -> HOJE) agregadas no pai.
// - usado SOMENTE quando sales_no_sales_after=true
async function fetchSalesAfterMap({
  token,
  sellerId,
  date_to,
  itemToParent = null,
}) {
  const out = new Map();
  const from = String(date_to || "").trim();
  if (!from) return out;

  const today = new Date().toISOString().slice(0, 10);
  if (from >= today) return out;

  // ✅ calcula uma vez só
  const fromDt = new Date(`${from}T00:00:00.000Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() + 1);
  const fromIso = fromDt.toISOString().slice(0, 10);

  let offset = 0;
  const limit = 50;

  for (;;) {
    const url = new URL("https://api.mercadolibre.com/orders/search");
    url.searchParams.set("seller", String(sellerId));
    url.searchParams.set("order.status", "paid");
    url.searchParams.set(
      "order.date_created.from",
      `${fromIso}T00:00:00.000-00:00`
    );
    url.searchParams.set(
      "order.date_created.to",
      `${today}T23:59:59.999-00:00`
    );
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const j = await httpGetJson(
      url.toString(),
      { Authorization: `Bearer ${token}` },
      3
    );
    const results = Array.isArray(j?.results) ? j.results : [];

    for (const order of results) {
      for (const it of order.order_items || []) {
        const rawId = upper(it?.item?.id);
        if (!rawId) continue;

        const mlb = itemToParent?.get(rawId) || rawId;

        const qty = Number(it?.quantity || 0);
        const unit = Number(it?.unit_price || 0);
        const revenue = unit * qty;

        const prev = out.get(mlb) || { units: 0, revenue_cents: 0 };
        prev.units += qty;
        prev.revenue_cents += Math.round(revenue * 100);
        out.set(mlb, prev);
      }
    }

    offset += limit;
    const total = Number(j?.paging?.total || 0);
    if (!total || offset >= total) break;
  }

  return out;
}

// Visitas: 1 item por request (N requests). Só usar quando filtro estiver ativo.
async function fetchVisitsMap({
  token,
  ids,
  date_from,
  date_to,
  concurrency = 4,
}) {
  const out = new Map();
  const queue = ids.slice();

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;

      const qs = new URLSearchParams();
      qs.set("ids", id);
      qs.set("date_from", date_from);
      qs.set("date_to", date_to);
      qs.set("unit", "day");
      qs.set("access_token", token);

      const url = `https://api.mercadolibre.com/items/visits?${qs.toString()}`;

      try {
        const j = await httpGetJson(url, {}, 2);
        const arr = Array.isArray(j)
          ? j
          : Array.isArray(j?.results)
          ? j.results
          : [];
        const v = arr[0];
        const total = Number(v?.total_visits ?? v?.total ?? 0);
        out.set(id, Number.isFinite(total) ? total : 0);
      } catch {
        out.set(id, 0);
      }

      await sleep(80);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return out;
}

class FiltroAnunciosQueueService {
  constructor() {
    this.queue = new Bull("Filtro Anuncios Export Queue", {
      createClient: () => makeRedis(),
    });
    this.resultsDir = path.join(__dirname, "../results");
    this._ensureDir();
    this._setupProcessor();
  }

  async _ensureDir() {
    try {
      await fs.access(this.resultsDir);
    } catch {
      await fs.mkdir(this.resultsDir, { recursive: true });
    }
  }

  _metaPath(jobId) {
    return path.join(this.resultsDir, `${jobId}_filtro_metadata.json`);
  }
  _dataPath(jobId) {
    return path.join(this.resultsDir, `${jobId}_filtro_resultados.json`);
  }

  async _writeMeta(jobId, patch) {
    const p = this._metaPath(jobId);
    let cur = {};
    try {
      cur = JSON.parse(await fs.readFile(p, "utf8"));
    } catch {}
    cur = { ...cur, ...patch, updated_at: new Date().toISOString() };
    await fs.writeFile(p, JSON.stringify(cur, null, 2));
  }

  _setupProcessor() {
    this.queue.process("export", 1, async (job) => {
      const { token, filters } = job.data;
      const jobId = String(job.id);

      await this._writeMeta(jobId, {
        job_id: jobId,
        status: "processando",
        created_at: new Date().toISOString(),
        filters,
      });

      try {
        job.progress(2);

        const sellerId = await getSellerId(token);
        job.progress(6);

        const wantedStatus = String(filters.status || "all");
        const statuses =
          wantedStatus === "all" ? ["active", "paused"] : [wantedStatus];

        let allIds = [];
        for (const st of statuses) {
          const ids = await fetchAllItemIds({ token, sellerId, status: st });
          allIds.push(...ids);
        }
        allIds = Array.from(new Set(allIds));
        job.progress(15);

        // 2) detalhes do item (barato)
        const items = [];
        const batches = chunk(allIds, 20);
        for (let i = 0; i < batches.length; i++) {
          const part = await fetchItemsBatch({ token, ids: batches[i] });
          items.push(...part);
          const pct = 15 + Math.round(((i + 1) / batches.length) * 20);
          job.progress(Math.min(pct, 35));
          await sleep(60);
        }

        // Map item_id -> parent_id (se existir). Isso permite agregar VENDAS no pai.
        const itemToParent = new Map();
        for (const it of items) {
          const itemId = upper(it?.id);
          if (!itemId) continue;
          const parentId = upper(it?.parent_item_id) || itemId;
          itemToParent.set(itemId, parentId);
          // também garante que pai aponta pra ele mesmo
          if (!itemToParent.has(parentId)) itemToParent.set(parentId, parentId);
        }

        // normaliza estrutura base "por anúncio (pai)"
        // - mlb = parentId (quando existir)
        // - dedup por mlb (se vierem itens "filhos")
        const byMlb = new Map();
        const dateTo = String(filters.date_to || "").trim(); // YYYY-MM-DD

        for (const it of items) {
          const itemId = upper(it?.id);
          if (!itemId) continue;

          const parentId = upper(it?.parent_item_id) || itemId;
          const created = datePart(it?.date_created); // YYYY-MM-DD

          // ✅ REGRA: incluir apenas anúncios criados até date_to
          // comparação por "YYYY-MM-DD" (sem dor com timezone)
          if (dateTo && created && created > dateTo) {
            continue;
          }

          const row = {
            mlb: parentId, // <- anúncio (pai)
            item_id: itemId, // <- id original (debug/futuro)
            parent_item_id: parentId !== itemId ? parentId : null,

            date_created: created || null,
            status: it?.status || null,

            sku: it?.seller_custom_field || it?.seller_sku || null,
            title: it?.title || "",
            listing_type_id: it?.listing_type_id || null,
            tipo: mapTipo(it?.listing_type_id),
            catalog_listing: !!it?.catalog_listing,
            detalhes: mapDetalhes(it),
            shipping_free: !!it?.shipping?.free_shipping,
            envio: mapEnvio(it?.shipping),

            sales_units: 0,
            sold_value_cents: 0,
            visits: null, // <- null pra UI mostrar "-"

            // ✅ NOVO (só preenche se checkbox ativo)
            sales_after_units: 0,
            sales_after_value_cents: 0,
          };

          const cur = byMlb.get(parentId);
          if (!cur) {
            byMlb.set(parentId, row);
          } else {
            // merge leve: mantém o melhor/mais antigo date_created
            if (!cur.date_created && row.date_created)
              cur.date_created = row.date_created;
            if (
              cur.date_created &&
              row.date_created &&
              row.date_created < cur.date_created
            )
              cur.date_created = row.date_created;

            // mantém title/sku se faltando
            if (!cur.title && row.title) cur.title = row.title;
            if (!cur.sku && row.sku) cur.sku = row.sku;

            // status: se não tiver, pega
            if (!cur.status && row.status) cur.status = row.status;
          }
        }

        let rows = Array.from(byMlb.values()).filter((r) => r.mlb);

        // 3) filtros baratos
        if (filters.envio && filters.envio !== "all") {
          rows = rows.filter((r) => {
            if (filters.envio === "free") return r.shipping_free === true;
            if (filters.envio === "buyer") return r.shipping_free === false;
            return true;
          });
        }

        if (filters.tipo && filters.tipo !== "all") {
          rows = rows.filter((r) => {
            const id = String(r.listing_type_id || "").toLowerCase();
            if (filters.tipo === "classic") return id === "gold_special";
            if (filters.tipo === "premium")
              return id === "gold_pro" || id === "gold_premium";
            return true;
          });
        }

        // ⚠️ detalhes você pode manter mesmo sem exibir coluna; filtro continua útil
        if (filters.detalhes && filters.detalhes !== "all") {
          rows = rows.filter((r) => {
            if (filters.detalhes === "catalog")
              return r.catalog_listing === true;
            if (filters.detalhes === "normal")
              return r.catalog_listing === false;
            return true;
          });
        }

        job.progress(42);

        // 4) vendas agregadas "por anúncio (pai)"
        const needSales =
          (filters.sales_op && filters.sales_op !== "all") ||
          filters.sort_by === "sold_value" ||
          true;

        if (needSales) {
          const salesMap = await fetchSalesMap({
            token,
            sellerId,
            date_from: filters.date_from,
            date_to: filters.date_to,
            itemToParent,
          });

          for (const r of rows) {
            const s = salesMap.get(r.mlb) || { units: 0, revenue_cents: 0 };
            r.sales_units = s.units;
            r.sold_value_cents = s.revenue_cents;
          }
        }

        if (filters.sales_op && filters.sales_op !== "all") {
          const val = Number(filters.sales_value || 0);
          rows = rows.filter((r) => {
            if (filters.sales_op === "gt") return (r.sales_units || 0) > val;
            if (filters.sales_op === "lt") return (r.sales_units || 0) < val;
            return true;
          });
        }

        // ✅ NOVO: quando checkbox ativo, exige 0 vendas após o período (até hoje)
        // Observação: isso resolve exatamente o caso "0 no período mas vendeu em junho".
        if (filters.sales_no_sales_after) {
          // reforço extra (mesmo que já validou no router)
          const v = Number(filters.sales_value || 0);
          const op = String(filters.sales_op || "all");
          const ok = (op === "lt" && v === 1) || v === 0;
          if (ok) {
            job.progress(74);

            const afterMap = await fetchSalesAfterMap({
              token,
              sellerId,
              date_to: filters.date_to,
              itemToParent,
            });

            // marca e filtra
            rows = rows.filter((r) => {
              const s = afterMap.get(r.mlb) || { units: 0, revenue_cents: 0 };
              r.sales_after_units = s.units;
              r.sales_after_value_cents = s.revenue_cents;
              return (s.units || 0) === 0;
            });
          }
        }

        job.progress(78);

        // 5) visitas — SOMENTE se filtro de visitas estiver ativo
        const needVisits = filters.visits_op && filters.visits_op !== "all";

        if (needVisits) {
          const ids = rows.map((r) => r.mlb); // pai
          const visitsMap = await fetchVisitsMap({
            token,
            ids,
            date_from: filters.date_from,
            date_to: filters.date_to,
            concurrency: 4,
          });

          for (const r of rows) r.visits = visitsMap.get(r.mlb) ?? 0;

          const vvNeed = Number(filters.visits_value || 0);
          rows = rows.filter((r) => {
            const vv = Number(r.visits || 0);
            if (filters.visits_op === "gt") return vv > vvNeed;
            if (filters.visits_op === "lt") return vv < vvNeed;
            return true;
          });
        } else {
          for (const r of rows) r.visits = null;
        }

        job.progress(86);

        // 6) sort
        const dir =
          String(filters.sort_dir || "desc").toLowerCase() === "asc" ? 1 : -1;
        const by = String(filters.sort_by || "sold_value");

        rows.sort((a, b) => {
          if (by === "title") {
            return (
              dir * String(a.title || "").localeCompare(String(b.title || ""))
            );
          }
          if (by === "sales_units") {
            return dir * ((a.sales_units || 0) - (b.sales_units || 0));
          }
          return dir * ((a.sold_value_cents || 0) - (b.sold_value_cents || 0));
        });

        await fs.writeFile(
          this._dataPath(jobId),
          JSON.stringify(rows, null, 2)
        );

        await this._writeMeta(jobId, {
          status: "concluido",
          total: rows.length,
          finished_at: new Date().toISOString(),
        });

        job.progress(100);
        return { total: rows.length };
      } catch (e) {
        await this._writeMeta(jobId, {
          status: "erro",
          error: e.message || String(e),
          finished_at: new Date().toISOString(),
        });
        throw e;
      }
    });
  }

  async enqueue({ token, filters }) {
    const job = await this.queue.add(
      "export",
      { token, filters },
      {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 50,
      }
    );
    return String(job.id);
  }

  async getStatus(jobId) {
    const job = await this.queue.getJob(jobId);
    let meta = {};
    try {
      meta = JSON.parse(await fs.readFile(this._metaPath(jobId), "utf8"));
    } catch {}

    return {
      job_id: jobId,
      status: meta.status || (job ? "processando" : "desconhecido"),
      progress: job ? job._progress || 0 : 0,
      total: meta.total ?? null,
      error: meta.error ?? null,
    };
  }

  async getResults(jobId) {
    const raw = await fs.readFile(this._dataPath(jobId), "utf8");
    return JSON.parse(raw);
  }
}

module.exports = new FiltroAnunciosQueueService();
