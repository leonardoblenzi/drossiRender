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
  return String(v || "")
    .trim()
    .toUpperCase();
}

function isInvalidAccessToken(details) {
  const msg = String(
    details?.response?.message || details?.response?.error || ""
  )
    .toLowerCase()
    .trim();
  const code = String(details?.response?.code || "")
    .toLowerCase()
    .trim();
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

  // 429: rate limit -> espera um pouco e tenta novamente
  if (r.status === 429 && attempt < maxAttempts) {
    await sleep(900 + attempt * 500);
    return mlGET(path, ctx, {
      ...opts,
      token,
      attempt: attempt + 1,
      maxAttempts,
    });
  }

  // 401: tenta buscar token fresco via adapter e retry 1x
  if (
    r.status === 401 &&
    attempt < maxAttempts &&
    isInvalidAccessToken(details)
  ) {
    const adapter = req?.app?.get?.("getAccessTokenForAccount");
    if (typeof adapter === "function" && meli_conta_id) {
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

      if (
        freshToken &&
        String(freshToken).trim() &&
        String(freshToken) !== token
      ) {
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
 * Busca VENDAS (40d) por orders:
 * - seller = userId
 * - item = MLB
 * - janela: last 40 days
 * - apenas pedidos pagos/confirmados
 * Retorna { qty, series } (series opcional/NULL por enquanto)
 */
async function fetchSold40dByOrders({ ctx, userId, mlb, days = 40 }) {
  const cleanMlb = normalizeMlb(mlb);
  if (!userId || !cleanMlb) return { qty: 0, series: null };

  // janela (UTC)
  const now = new Date();
  const from = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();

  // status aceitos (apenas pagos/confirmados)
  const allowed = new Set(["paid", "confirmed"]);

  let totalQty = 0;

  // paginação offset/limit
  const limit = 50;
  let offset = 0;
  let guard = 0;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("seller", String(userId));
    qs.set("item", cleanMlb);

    // filtro por data (orders search aceita range por date_created)
    // formato: order.date_created.from=ISO
    qs.set("order.date_created.from", fromIso);

    // paginação
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));

    // ⚠️ Não colocamos status=paid aqui para não depender da semântica exata;
    // filtramos localmente por segurança e compatibilidade.
    const data = await mlGET(`/orders/search?${qs.toString()}`, ctx, {
      maxAttempts: 3, // orders costuma rate-limit mais
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) break;

    for (const o of results) {
      const st = String(o?.status || "")
        .toLowerCase()
        .trim();
      if (!allowed.has(st)) continue;

      const items = Array.isArray(o?.order_items) ? o.order_items : [];
      for (const it of items) {
        const itemId = String(it?.item?.id || it?.item_id || "").toUpperCase();
        if (itemId !== cleanMlb) continue;
        totalQty += Number(it?.quantity || 0);
      }
    }

    const paging = data?.paging || {};
    const total = asInt(paging.total, 0);

    offset += limit;
    if (offset >= total) break;

    // guard rail
    guard += 1;
    if (guard > 400) break;

    await sleep(120);
  }

  return { qty: Math.max(0, Math.trunc(totalQty)), series: null };
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

// ✅ lê sold_40d atual do DB (para fallback quando Orders API não estiver disponível)
async function getExistingSold40d({ meli_conta_id, mlb }) {
  const r = await db.query(
    `SELECT sold_40d FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = $2 LIMIT 1;`,
    [meli_conta_id, normalizeMlb(mlb)]
  );
  return Number(r.rows?.[0]?.sold_40d || 0);
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

  async addManual({ meli_conta_id, mlb }) {
    return insertManual({ meli_conta_id, mlb });
  },

  async addOrUpdateFromML({ req, res, meli_conta_id, mlb, opts = {} }) {
    const ctx = { req, res, meli_conta_id };

    const cleanMlb = normalizeMlb(mlb);

    // 1) item básico
    const item = await mlGET(`/items/${encodeURIComponent(cleanMlb)}`, ctx);
    const inventory_id = item?.inventory_id || null;

    if (!inventory_id && opts.onlyIfFull) return null;

    // 2) stock fulfillment (se inventory_id)
    let stock = null;
    if (inventory_id) {
      stock = await mlGET(
        `/inventories/${encodeURIComponent(inventory_id)}/stock/fulfillment`,
        ctx
      );
    }

    // 3) seller id (pra orders)
    // preferimos pegar do item; se faltar, usamos /users/me
    let sellerId = item?.seller_id || null;
    if (!sellerId) {
      const me = await getMe(ctx);
      sellerId = me?.id || null;
    }

    // 4) sold_total sempre vem do item
    const sold_total = Number(item?.sold_quantity || 0);

    // 5) sold_40d REAL via Orders API (paid/confirmed)
    // Se falhar por permissão/escopo, mantém valor atual no DB (fallback)
    let sold_40d = 0;
    let sales_series_40d = null;

    try {
      const out40 = await fetchSold40dByOrders({
        ctx,
        userId: sellerId,
        mlb: cleanMlb,
        days: 40,
      });
      sold_40d = Number(out40?.qty || 0);
      sales_series_40d = out40?.series || null;
    } catch (e) {
      // fallback: não derruba o sync do item
      // (normalmente 403: forbidden por falta de escopo de orders)
      sold_40d = await getExistingSold40d({ meli_conta_id, mlb: cleanMlb });
      sales_series_40d = null;
    }

    return upsertRow({
      meli_conta_id,
      mlb: cleanMlb,
      sku: pickSkuFromItem(item),
      title: item?.title || null,
      image_url: pickImageUrl(item),
      inventory_id,
      price: item?.price ?? item?.base_price ?? null,
      stock_full: Number(stock?.available_quantity || 0),
      sold_total,
      sold_40d,
      listing_status: item?.status || null,
      status: deriveUiStatus(item, stock),
      sales_series_40d,
    });
  },

  async sync({ req, res, meli_conta_id, mlbs, mode }) {
    const upperMode = String(mode || "").toUpperCase();

    if (upperMode === "IMPORT_ALL") {
      const err = new Error(
        'Modo "IMPORT_ALL" foi desativado. Adicione MLBs manualmente e use "Sincronizar" para atualizar as colunas.'
      );
      err.statusCode = 400;
      throw err;
    }

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
            sold_total: row.sold_total,
            sold_40d: row.sold_40d,
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
