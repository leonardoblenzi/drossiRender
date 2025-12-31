"use strict";

const FullService = require("../services/fullService");

function pickContaId(req) {
  const raw = req.cookies?.meli_conta_id;
  const meli_conta_id = Number(raw);
  if (!meli_conta_id || Number.isNaN(meli_conta_id)) return null;
  return meli_conta_id;
}

module.exports = {
  async list(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(
        200,
        Math.max(10, Number(req.query.pageSize || 25))
      );
      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "all");

      const out = await FullService.list({
        meli_conta_id,
        page,
        pageSize,
        q,
        status,
      });
      return res.json({ success: true, ...out });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Erro ao listar FULL",
        message: error.message,
      });
    }
  },

  async add(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlb = String(req.body?.mlb || "")
        .trim()
        .toUpperCase();
      if (!mlb || !mlb.startsWith("MLB")) {
        return res.status(400).json({ success: false, error: "MLB inválido." });
      }

      const row = await FullService.addOrUpdateFromML({
        req,
        res,
        meli_conta_id,
        mlb,
      });
      return res.json({ success: true, item: row });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: "Erro ao adicionar FULL",
        message: error.message,
        details: error.details || null,
      });
    }
  },

 "use strict";

const db = require("../db/db");

// Node 18+ já tem fetch global. Se estiver em Node 16, descomente:
// const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const ML_BASE = "https://api.mercadolibre.com";

function getAccessToken(req, res) {
  // ✅ ajuste se seu projeto guarda token em outro local
  // (Ex.: res.locals.meli.access_token, req.meli.access_token etc.)
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
    err.details = json;
    throw err;
  }

  return json;
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
  // status para o filtro da UI
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
    const offset = (page - 1) * pageSize;

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

  async addOrUpdateFromML({ req, res, meli_conta_id, mlb }) {
    const token = getAccessToken(req, res);

    // 1) /items/{MLB} => inventory_id, title, price, sold, pictures, sku...
    const item = await mlGET(`/items/${encodeURIComponent(mlb)}`, token);

    const inventory_id = item?.inventory_id || null;

    // Se não tem inventory_id, não está “rodando no FULL” nesse formato
    // mas ainda salvamos como ineligible pra UI mostrar claramente.
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
      sold_40d: 0, // por enquanto (se quiser, depois a gente calcula com orders)
      listing_status: item?.status || null,
      status: deriveUiStatus(item, stock),
      sales_series_40d: null,
    });

    return row;
  },

  async sync({ req, res, meli_conta_id, mlbs }) {
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
          res,
          meli_conta_id,
          mlb: String(mlb).trim().toUpperCase(),
        });
        ok.push({
          mlb: row.mlb,
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


  async bulkDelete(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlbs = Array.isArray(req.body?.mlbs) ? req.body.mlbs : [];
      if (!mlbs.length) {
        return res
          .status(400)
          .json({ success: false, error: "Nenhum MLB informado." });
      }

      const out = await FullService.bulkDelete({ meli_conta_id, mlbs });
      return res.json({ success: true, ...out });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Erro ao remover em lote",
        message: error.message,
      });
    }
  },

  async removeOne(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlb = String(req.params.mlb || "")
        .trim()
        .toUpperCase();
      const out = await FullService.bulkDelete({ meli_conta_id, mlbs: [mlb] });
      return res.json({ success: true, ...out });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Erro ao remover",
        message: error.message,
      });
    }
  },
};
