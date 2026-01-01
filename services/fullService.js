"use strict";

const db = require("../db/db");

const ML_BASE = "https://api.mercadolibre.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asInt(v, def) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeMlb(v) {
  return String(v || "").trim().toUpperCase();
}

function isInvalidAccessToken(details) {
  const msg = String(details?.response?.message || details?.response?.error || "")
    .toLowerCase()
    .trim();
  const code = String(details?.response?.code || "").toLowerCase().trim();
  return code === "unauthorized" || msg.includes("invalid access token");
}

/**
 * Tenta obter token do middleware (res.locals) e, se faltar/ruim,
 * cai no adapter injetado no app: app.get("getAccessTokenForAccount").
 */
async function getAccessToken(req, res, meli_conta_id) {
  // ✅ 1) PRIORIDADE: token já validado pelo authMiddleware
  const tokenFromReq = req?.ml?.accessToken;
  if (tokenFromReq && String(tokenFromReq).trim()) {
    return String(tokenFromReq).trim();
  }

  // ✅ 2) compat: casos antigos (locals)
  const tokenFromLocals =
    res?.locals?.mlCreds?.access_token ||
    res?.locals?.access_token ||
    res?.locals?.meli?.access_token;

  if (tokenFromLocals && String(tokenFromLocals).trim()) {
    return String(tokenFromLocals).trim();
  }

  // ✅ 3) fallback: adapter (ml-auth)
  const adapter = req?.app?.get?.("getAccessTokenForAccount");
  if (typeof adapter === "function" && meli_conta_id) {
    const creds = await adapter(meli_conta_id);
    const t =
      typeof creds === "string"
        ? creds
        : creds?.access_token || creds?.token || null;

    if (t && String(t).trim()) return String(t).trim();
  }

  const err = new Error(
    "Token ML não disponível (middleware não injetou e adapter não retornou)."
  );
  err.statusCode = 401;
  throw err;
}


async function mlGET(path, ctx, opts = {}) {
  const { req, res, meli_conta_id } = ctx || {};
  const url = `${ML_BASE}${path}`;

  const attempt = asInt(opts.attempt, 1);
  const maxAttempts = asInt(opts.maxAttempts, 2);

  const token = opts.token || (await getAccessToken(req, res, meli_conta_id));

  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const raw = await r.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { raw };
  }

  if (r.ok) return json;

  const details = {
    path,
    url,
    status: r.status,
    response: json,
    raw_preview: String(raw || "").slice(0, 300),
  };

  // 429: rate limit / too many requests -> espera um pouco e tenta novamente
  if (r.status === 429 && attempt < maxAttempts) {
    await sleep(800 + attempt * 400);
    return mlGET(path, ctx, {
      ...opts,
      token, // mantém token
      attempt: attempt + 1,
      maxAttempts,
    });
  }

  // 401: tenta buscar token fresco via adapter e retry 1x
  if (r.status === 401 && attempt < maxAttempts && isInvalidAccessToken(details)) {
    const adapter = req?.app?.get?.("getAccessTokenForAccount");
    if (typeof adapter === "function" && meli_conta_id) {
      // tentamos “forçar” refresh de forma defensiva (caso seu adapter aceite args)
      let fresh = null;
      try {
        fresh = await adapter(meli_conta_id, { forceRefresh: true });
      } catch {
        fresh = await adapter(meli_conta_id);
      }

      const freshToken =
        typeof fresh === "string"
          ? fresh
          : fresh?.access_token || fresh?.token || null;

      if (freshToken && String(freshToken).trim() && String(freshToken) !== token) {
        return mlGET(path, ctx, {
          ...opts,
          token: String(freshToken).trim(),
          attempt: attempt + 1,
          maxAttempts,
        });
      }
    }
  }

  const err = new Error(json?.message || `Erro ML ${r.status}`);
  err.statusCode = r.status;
  err.details = details;
  throw err;
}

async function getMe(ctx) {
  return mlGET(`/users/me`, ctx);
}

/**
 * LISTAGEM DO SELLER (MUITOS ITENS):
 * usa search_type=scan + scroll_id (cursor) para evitar estouro de offset.
 */
async function listUserItemsScan(
  userId,
  ctx,
  { status = "active", limit = 50, max = 5000 } = {}
) {
  const out = [];

  const safeLimit = clamp(asInt(limit, 50), 1, 50);
  const safeMax = Math.max(1, asInt(max, 5000));

  let scroll_id = null;
  let guard = 0;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("search_type", "scan");
    qs.set("limit", String(safeLimit));
    if (status && status !== "all") qs.set("status", status);
    if (scroll_id) qs.set("scroll_id", String(scroll_id));

    const data = await mlGET(
      `/users/${encodeURIComponent(String(userId))}/items/search?${qs.toString()}`,
      ctx
    );

    const ids = Array.isArray(data?.results) ? data.results : [];
    out.push(...ids);

    scroll_id = data?.scroll_id || data?.scrollId || null;

    if (!ids.length) break;
    if (out.length >= safeMax) break;

    // “guard rail” para não loopar infinito se API mudar comportamento
    guard += 1;
    if (guard > 10000) break;

    await sleep(120);
  }

  return out.slice(0, safeMax);
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

async function insertManual({ meli_conta_id, mlb }) {
  const clean = normalizeMlb(mlb);
  if (!clean || !clean.startsWith("MLB")) {
    const err = new Error("MLB inválido.");
    err.statusCode = 400;
    throw err;
  }

  // bloqueio duplicado no backend (front já bloqueia, mas aqui garante)
  const existsR = await db.query(
    `SELECT 1 FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = $2 LIMIT 1;`,
    [meli_conta_id, clean]
  );
  if (existsR.rowCount > 0) {
    const err = new Error("Esse MLB já está cadastrado na lista FULL.");
    err.statusCode = 409;
    throw err;
  }

  const q = `
    INSERT INTO anuncios_full
      (meli_conta_id, mlb, sku, title, image_url, inventory_id, price, stock_full, sold_total, sold_40d, listing_status, status, sales_series_40d, last_synced_at, created_at, updated_at)
    VALUES
      ($1,$2,NULL,NULL,NULL,NULL,NULL,0,0,0,NULL,'ineligible',NULL,NULL,NOW(),NOW())
    RETURNING *;
  `;
  const r = await db.query(q, [meli_conta_id, clean]);
  return r.rows[0];
}

async function getLastSyncAtForAccount(meli_conta_id) {
  const r = await db.query(
    `SELECT MAX(last_synced_at) AS last_sync_at FROM anuncios_full WHERE meli_conta_id = $1;`,
    [meli_conta_id]
  );
  return r.rows?.[0]?.last_sync_at || null;
}

module.exports = {
  async list({ meli_conta_id, page, pageSize, q, status }) {
    const safePage = Math.max(1, asInt(page, 1));
    const safePageSize = clamp(asInt(pageSize, 25), 10, 200);
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

    // ✅ para o cabeçalho "Última atualização em:"
    const last_sync_at = await getLastSyncAtForAccount(meli_conta_id);

    return {
      last_sync_at,
      paging: {
        page: safePage,
        pageSize: safePageSize,
        total,
        pages: Math.max(1, Math.ceil(total / safePageSize)),
      },
      results: listR.rows,
    };
  },

  // ✅ NOVO: Adicionar MLB manualmente (sem sync pesado)
  async addManual({ meli_conta_id, mlb }) {
    return insertManual({ meli_conta_id, mlb });
  },

  async addOrUpdateFromML({ req, res, meli_conta_id, mlb, opts = {} }) {
    const ctx = { req, res, meli_conta_id };

    const item = await mlGET(`/items/${encodeURIComponent(mlb)}`, ctx);
    const inventory_id = item?.inventory_id || null;

    if (!inventory_id && opts.onlyIfFull) return null;

    let stock = null;
    if (inventory_id) {
      stock = await mlGET(
        `/inventories/${encodeURIComponent(inventory_id)}/stock/fulfillment`,
        ctx
      );
    }

    return upsertRow({
      meli_conta_id,
      mlb,
      sku: pickSkuFromItem(item),
      title: item?.title || null,
      image_url: pickImageUrl(item),
      inventory_id,
      price: item?.price ?? item?.base_price ?? null,
      stock_full: Number(stock?.available_quantity || 0),
      sold_total: Number(item?.sold_quantity || 0),
      // por enquanto mantém 0; quando você ligar métricas 40d no DB, atualizamos aqui
      sold_40d: 0,
      listing_status: item?.status || null,
      status: deriveUiStatus(item, stock),
      sales_series_40d: null,
    });
  },

  async sync({ req, res, meli_conta_id, mlbs, mode }) {
    const upperMode = String(mode || "").toUpperCase();

    // ✅ IMPORT_ALL desativado (novo comportamento)
    if (upperMode === "IMPORT_ALL") {
      const err = new Error(
        'Modo "IMPORT_ALL" foi desativado. Adicione MLBs manualmente e use "Sincronizar" para atualizar as colunas.'
      );
      err.statusCode = 400;
      throw err;
    }

    // ✅ SYNC normal (selecionados ou DB todo)
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
      const clean = normalizeMlb(mlb);
      if (!clean) continue;

      try {
        const row = await this.addOrUpdateFromML({
          req,
          res,
          meli_conta_id,
          mlb: clean,
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
          mlb: clean,
          message: e.message,
          statusCode: e.statusCode || 500,
          details: e.details || null,
        });
      }
    }

    const last_sync_at = await getLastSyncAtForAccount(meli_conta_id);

    return {
      mode: "SYNC",
      updated: ok.length,
      failed: fail.length,
      ok,
      fail,
      last_sync_at,
    };
  },

  async bulkDelete({ meli_conta_id, mlbs }) {
    const clean = (Array.isArray(mlbs) ? mlbs : [])
      .map((x) => normalizeMlb(x))
      .filter(Boolean);

    const r = await db.query(
      `DELETE FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = ANY($2::text[])`,
      [meli_conta_id, clean]
    );

    return { deleted: r.rowCount || 0 };
  },
};
