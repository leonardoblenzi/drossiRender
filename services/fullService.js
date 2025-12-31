"use strict";

const db = require("../db/db");

const ML_BASE = "https://api.mercadolibre.com";

function getAccessTokenFromRequest(req, res) {
  // authMiddleware costuma colocar credenciais aqui (ajuste se seu projeto usa outro campo)
  const token =
    res?.locals?.mlCreds?.access_token ||
    res?.locals?.access_token ||
    req?.headers?.["x-ml-token"]; // fallback (não obrigatório)

  if (!token) {
    const err = new Error(
      "Token ML não disponível (authMiddleware não injetou)."
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
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!r.ok) {
    const err = new Error(json?.message || `Erro ML ${r.status}`);
    err.statusCode = r.status;
    err.details = json;
    throw err;
  }
  return json;
}

function pickSkuFromItem(item) {
  // SKU no ML pode aparecer em seller_custom_field ou em attributes (varia por categoria)
  if (item?.seller_custom_field) return String(item.seller_custom_field);

  const attrs = item?.attributes || [];
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
  // status "UI" pro filtro
  if (!item?.inventory_id) return "ineligible";
  if (!stock) return "active";

  const available = Number(stock.available_quantity || 0);
  const total = Number(stock.total || 0);

  const notAvail = Array.isArray(stock.not_available_detail)
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

async function upsertFullRow({
  meli_conta_id,
  mlb,
  sku,
  title,
  image_url,
  inventory_id,
  price,
  stock_full,
  sold_total,
  listing_status,
  status,
  sales_series_40d,
}) {
  const q = `
    INSERT INTO anuncios_full
      (meli_conta_id, mlb, sku, title, image_url, inventory_id, price, stock_full, sold_total, sold_40d, listing_status, status, sales_series_40d, last_synced_at, created_at, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),$11,$12,$13,NOW(),NOW(),NOW())
    ON CONFLICT (meli_conta_id, mlb)
    DO UPDATE SET
      sku = EXCLUDED.sku,
      title = EXCLUDED.title,
      image_url = EXCLUDED.image_url,
      inventory_id = EXCLUDED.inventory_id,
      price = EXCLUDED.price,
      stock_full = EXCLUDED.stock_full,
      sold_total = EXCLUDED.sold_total,
      listing_status = EXCLUDED.listing_status,
      status = EXCLUDED.status,
      sales_series_40d = EXCLUDED.sales_series_40d,
      last_synced_at = NOW(),
      updated_at = NOW()
    RETURNING *;
  `;

  const params = [
    meli_conta_id,
    mlb,
    sku,
    title,
    image_url,
    inventory_id,
    price,
    stock_full,
    sold_total,
    sales_series_40d ? 0 : 0, // sold_40d (mantemos 0 por enquanto)
    listing_status,
    status,
    sales_series_40d || null,
  ];

  const r = await db.query(q, params);
  return r.rows[0];
}

module.exports = {
  async list({ meli_conta_id, page, pageSize, q, status }) {
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [meli_conta_id];
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

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countQ = `SELECT COUNT(*)::int AS total FROM anuncios_full ${whereSql};`;
    const countR = await db.query(countQ, params);
    const total = countR.rows[0]?.total || 0;

    params.push(pageSize);
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
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
      results: listR.rows,
    };
  },

  async addOrUpdateFromML({ req, meli_conta_id, mlb }) {
    // usamos res.locals via "req.res"
    const res = req.res;
    const token = getAccessTokenFromRequest(req, res);

    // 1) Item (traz inventory_id quando for FULL)
    const item = await mlGET(`/items/${encodeURIComponent(mlb)}`, token);

    const inventory_id = item?.inventory_id || null;

    // 2) Stock fulfillment (se tiver inventory_id)
    let stock = null;
    if (inventory_id) {
      stock = await mlGET(
        `/inventories/${encodeURIComponent(inventory_id)}/stock/fulfillment`,
        token
      );
    }

    const row = await upsertFullRow({
      meli_conta_id,
      mlb,
      sku: pickSkuFromItem(item),
      title: item?.title || null,
      image_url: pickImageUrl(item),
      inventory_id,
      price: item?.price ?? item?.base_price ?? null,
      stock_full: Number(stock?.available_quantity || 0),
      sold_total: Number(item?.sold_quantity || 0),
      listing_status: item?.status || null,
      status: deriveUiStatus(item, stock),
      sales_series_40d: null, // opcional (futuro)
    });

    return row;
  },

  async sync({ req, meli_conta_id, mlbs }) {
    let targets = mlbs;

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
          meli_conta_id,
          mlb: String(mlb).toUpperCase(),
        });
        ok.push({
          mlb,
          id: row.id,
          status: row.status,
          stock_full: row.stock_full,
        });
      } catch (e) {
        fail.push({ mlb, message: e.message, statusCode: e.statusCode || 500 });
      }
    }

    return { updated: ok.length, failed: fail.length, ok, fail };
  },

  async bulkDelete({ meli_conta_id, mlbs }) {
    const clean = mlbs
      .map((x) =>
        String(x || "")
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);

    const r = await db.query(
      `DELETE FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = ANY($2::text[])`,
      [meli_conta_id, clean]
    );

    return { deleted: r.rowCount || 0 };
  },
};
