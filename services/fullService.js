"use strict";

const db = require("../db/db");

const ML_BASE = "https://api.mercadolibre.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function getAccessToken(req, res) {
  const token =
    res?.locals?.mlCreds?.access_token ||
    res?.locals?.access_token ||
    res?.locals?.meli?.access_token;

  if (!token) {
    const err = new Error(
      "Token ML não disponível (middleware não injetou access_token)."
    );
    err.statusCode = 401;
    throw err;
  }
  return token;
}

async function mlGET(path, token) {
  const url = `${ML_BASE}${path}`;
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!r.ok) {
    const err = new Error(json?.message || `Erro ML ${r.status}`);
    err.statusCode = r.status;
    err.details = {
      path,
      url,
      status: r.status,
      response: json,
      raw_preview: (text || "").slice(0, 600),
    };
    throw err;
  }

  return json;
}

async function getMe(token) {
  return mlGET(`/users/me`, token);
}

/**
 * Paginação tradicional com offset (boa para poucos itens)
 */
async function listUserItemsOffset(userId, token, { status, limit, max } = {}) {
  const out = [];
  const safeLimit = clampInt(limit, 1, 50, 50);
  const safeMax = clampInt(max, 1, 20000, 8000);

  let offset = 0;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("limit", String(safeLimit));
    qs.set("offset", String(offset));
    if (status && status !== "all") qs.set("status", status);

    const data = await mlGET(
      `/users/${encodeURIComponent(String(userId))}/items/search?${qs.toString()}`,
      token
    );

    const ids = Array.isArray(data?.results) ? data.results : [];
    out.push(...ids);

    const total = Number(data?.paging?.total || 0);
    offset += safeLimit;

    if (!ids.length) break;
    if (offset >= total) break;
    if (out.length >= safeMax) break;

    // proteção contra rate-limit
    await sleep(40);
  }

  return out.slice(0, safeMax);
}

/**
 * Paginação por SCAN (scroll_id) — correta para "varrer tudo" sem limite de offset
 */
async function listUserItemsScan(userId, token, { status, limit, max } = {}) {
  const out = [];
  const safeLimit = clampInt(limit, 1, 50, 50);
  const safeMax = clampInt(max, 1, 20000, 8000);

  let scrollId = null;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("search_type", "scan");
    qs.set("limit", String(safeLimit));
    if (status && status !== "all") qs.set("status", status);
    if (scrollId) qs.set("scroll_id", String(scrollId));

    const data = await mlGET(
      `/users/${encodeURIComponent(String(userId))}/items/search?${qs.toString()}`,
      token
    );

    const ids = Array.isArray(data?.results) ? data.results : [];
    if (!ids.length) break;

    out.push(...ids);

    // o ML retorna scroll_id (precisa ser reutilizado nas próximas chamadas)
    scrollId = data?.scroll_id || scrollId;

    if (out.length >= safeMax) break;

    await sleep(40);
  }

  return out.slice(0, safeMax);
}

/**
 * Decide automaticamente entre offset e scan.
 * Se der erro de offset inválido, faz fallback para scan.
 */
async function listUserItems(userId, token, { status = "active", limit = 50, max = 8000 } = {}) {
  const safeLimit = clampInt(limit, 1, 50, 50);
  const safeMax = clampInt(max, 1, 20000, 8000);

  // tenta primeiro pegar a primeira página pra estimar total
  try {
    const qs = new URLSearchParams();
    qs.set("limit", String(safeLimit));
    qs.set("offset", "0");
    if (status && status !== "all") qs.set("status", status);

    const first = await mlGET(
      `/users/${encodeURIComponent(String(userId))}/items/search?${qs.toString()}`,
      token
    );

    const total = Number(first?.paging?.total || 0);

    // se total é grande, já vai direto pra SCAN (evita estourar offset depois)
    if (total > 1000) {
      return await listUserItemsScan(userId, token, { status, limit: safeLimit, max: safeMax });
    }

    // se é pequeno, offset é mais simples/rápido
    return await listUserItemsOffset(userId, token, { status, limit: safeLimit, max: safeMax });
  } catch (e) {
    // fallback inteligente: se for erro clássico de offset/limit, vai de SCAN
    const msg = String(e?.message || "");
    const isOffsetErr = msg.includes("Invalid limit and offset values");
    if (isOffsetErr) {
      return await listUserItemsScan(userId, token, { status, limit: safeLimit, max: safeMax });
    }
    throw e;
  }
}

function pickSkuFromItem(item) {
  if (item?.seller_custom_field) return String(item.seller_custom_field);

  const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
  const skuAttr =
    attrs.find((a) => a?.id === "SELLER_SKU") ||
    attrs.find((a) => (a?.name || "").toLowerCase() === "sku") ||
    attrs.find((a) => (a?.name || "").toLowerCase().includes("sku"));

  if (skuAttr?.value_name) return String(skuAttr.value_name);
  if (skuAttr?.value_id) return String(skuAttr.value_id);

  return null;
}

function pickImageUrl(item) {
  const pic = item?.pictures?.[0]?.secure_url || item?.pictures?.[0]?.url;
  if (pic) return pic;
  if (item?.thumbnail) return item.thumbnail;
  return null;
}

function deriveUiStatus(item, stock) {
  if (!item?.inventory_id) return "ineligible";

  const available = Number(stock?.available_quantity || 0);
  const total = Number(stock?.total || 0);

  const notAvail = Array.isArray(stock?.not_available_detail)
    ? stock.not_available_detail
    : [];
  const hasTransfer = notAvail.some(
    (x) => String(x.status || "").toLowerCase() === "transfer"
  );

  if (available > 0) return "active";
  if (hasTransfer) return "intransfer";
  if (total > 0 && available === 0) return "no_stock";
  return "no_stock";
}

async function upsertRow(data) {
  const q = `
    INSERT INTO anuncios_full
      (meli_conta_id, mlb, sku, title, image_url, inventory_id, price, stock_full, sold_total, sold_40d, listing_status, status, sales_series_40d, last_synced_at, created_at, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW(),NOW())
    ON CONFLICT (meli_conta_id, mlb)
    DO UPDATE SET
      sku = EXCLUDED.sku,
      title = EXCLUDED.title,
      image_url = EXCLUDED.image_url,
      inventory_id = EXCLUDED.inventory_id,
      price = EXCLUDED.price,
      stock_full = EXCLUDED.stock_full,
      sold_total = EXCLUDED.sold_total,
      sold_40d = EXCLUDED.sold_40d,
      listing_status = EXCLUDED.listing_status,
      status = EXCLUDED.status,
      sales_series_40d = EXCLUDED.sales_series_40d,
      last_synced_at = NOW(),
      updated_at = NOW()
    RETURNING *;
  `;

  const params = [
    data.meli_conta_id,
    data.mlb,
    data.sku,
    data.title,
    data.image_url,
    data.inventory_id,
    data.price,
    data.stock_full,
    data.sold_total,
    data.sold_40d || 0,
    data.listing_status,
    data.status,
    data.sales_series_40d || null,
  ];

  const r = await db.query(q, params);
  return r.rows[0];
}

module.exports = {
  async list({ meli_conta_id, page, pageSize, q, status }) {
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(200, Math.max(10, Number(pageSize || 25)));
    const offset = (safePage - 1) * safePageSize;

    const where = [];
    const params = [];

    params.push(meli_conta_id);
    where.push(`meli_conta_id = $${params.length}`);

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        mlb ILIKE $${params.length}
        OR COALESCE(sku,'') ILIKE $${params.length}
        OR COALESCE(title,'') ILIKE $${params.length}
      )`);
    }

    if (status && status !== "all") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const countR = await db.query(
      `SELECT COUNT(*)::int AS total FROM anuncios_full ${whereSql};`,
      params
    );
    const total = countR.rows[0]?.total || 0;

    params.push(safePageSize);
    params.push(offset);

    const listQ = `
      SELECT *
      FROM anuncios_full
      ${whereSql}
      ORDER BY updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;

    const listR = await db.query(listQ, params);

    return {
      paging: {
        page: safePage,
        pageSize: safePageSize,
        total,
        pages: Math.max(1, Math.ceil(total / safePageSize)),
      },
      results: listR.rows,
    };
  },

  async addOrUpdateFromML({ req, res, meli_conta_id, mlb, opts = {} }) {
    const token = getAccessToken(req, res);

    const item = await mlGET(`/items/${encodeURIComponent(mlb)}`, token);
    const inventory_id = item?.inventory_id || null;

    // se for import FULL, não polui com não-FULL
    if (!inventory_id && opts.onlyIfFull) {
      return null;
    }

    let stock = null;
    if (inventory_id) {
      stock = await mlGET(
        `/inventories/${encodeURIComponent(inventory_id)}/stock/fulfillment`,
        token
      );
    }

    const row = await upsertRow({
      meli_conta_id,
      mlb,
      sku: pickSkuFromItem(item),
      title: item?.title || null,
      image_url: pickImageUrl(item),
      inventory_id,
      price: item?.price ?? item?.base_price ?? null,
      stock_full: Number(stock?.available_quantity || 0),
      sold_total: Number(item?.sold_quantity || 0),
      sold_40d: 0,
      listing_status: item?.status || null,
      status: deriveUiStatus(item, stock),
      sales_series_40d: null,
    });

    return row;
  },

  async sync({ req, res, meli_conta_id, mlbs, mode }) {
    const token = getAccessToken(req, res);

    // ✅ IMPORT_ALL: varre inventário do vendedor e grava apenas os que são FULL
    if (String(mode || "").toUpperCase() === "IMPORT_ALL") {
      const me = await getMe(token);
      const userId = me?.id;
      if (!userId) {
        const err = new Error("Não foi possível obter /users/me para importar.");
        err.statusCode = 500;
        throw err;
      }

      // lista todos os anúncios do usuário (usa SCAN automaticamente se precisar)
      const itemIds = await listUserItems(userId, token, {
        status: "active", // se quiser incluir pausados: "all"
        limit: 50,
        max: 8000,
      });

      let importedFull = 0;
      let skippedNotFull = 0;
      const fail = [];

      for (const id of itemIds) {
        const mlb = String(id || "").trim().toUpperCase();
        if (!mlb) continue;

        try {
          const row = await this.addOrUpdateFromML({
            req,
            res,
            meli_conta_id,
            mlb,
            opts: { onlyIfFull: true },
          });

          if (!row) skippedNotFull += 1;
          else importedFull += 1;

          await sleep(80);
        } catch (e) {
          fail.push({
            mlb,
            message: e.message,
            statusCode: e.statusCode || 500,
            details: e.details || null,
          });
        }
      }

      return {
        mode: "IMPORT_ALL",
        scanned: itemIds.length,
        imported_full: importedFull,
        skipped_not_full: skippedNotFull,
        failed: fail.length,
        fail,
      };
    }

    // ===== SYNC normal =====
    let targets = Array.isArray(mlbs) ? mlbs : null;

    if (!targets) {
      const r = await db.query(
        `SELECT mlb FROM anuncios_full WHERE meli_conta_id = $1 ORDER BY updated_at DESC`,
        [meli_conta_id]
      );
      targets = r.rows.map((x) => x.mlb);
    }

    const ok = [];
    const fail = [];

    for (const mlb of targets) {
      try {
        const row = await this.addOrUpdateFromML({
          req,
          res,
          meli_conta_id,
          mlb: String(mlb).trim().toUpperCase(),
        });

        if (row) {
          ok.push({
            mlb: row.mlb,
            status: row.status,
            stock_full: row.stock_full,
          });
        }
      } catch (e) {
        fail.push({
          mlb,
          message: e.message,
          statusCode: e.statusCode || 500,
          details: e.details || null,
        });
      }
    }

    return { mode: "SYNC", updated: ok.length, failed: fail.length, ok, fail };
  },

  async bulkDelete({ meli_conta_id, mlbs }) {
    const clean = (Array.isArray(mlbs) ? mlbs : [])
      .map((x) => String(x || "").trim().toUpperCase())
      .filter(Boolean);

    const r = await db.query(
      `DELETE FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = ANY($2::text[])`,
      [meli_conta_id, clean]
    );

    return { deleted: r.rowCount || 0 };
  },
};
