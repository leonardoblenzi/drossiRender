"use strict";

const db = require("../db/db");

const ML_BASE = "https://api.mercadolibre.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getAccessToken(req, res) {
  // ✅ ajuste se seu projeto guarda token em outro local
  const token =
    res?.locals?.mlCreds?.access_token ||
    res?.locals?.access_token ||
    res?.locals?.meli?.access_token;

  if (!token) {
    const err = new Error(
      "Token ML não disponível (middleware não injetou access_token)."
    );
    err.statusCode = 401;
    err.details = { hint: "Verifique authMiddleware e res.locals.mlCreds" };
    throw err;
  }
  return token;
}

async function safeReadText(resp) {
  try {
    return (await resp.text()) || "";
  } catch {
    return "";
  }
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

  const text = await safeReadText(r);

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!r.ok) {
    // ✅ erro mais "debugável"
    const err = new Error(json?.message || `Erro ML ${r.status}`);
    err.statusCode = r.status;
    err.details = {
      path,
      url,
      status: r.status,
      response: json,
      raw_preview:
        typeof text === "string" ? text.slice(0, 500) : String(text),
    };
    throw err;
  }

  return json;
}

async function getMe(token) {
  return mlGET(`/users/me`, token);
}

async function listUserItems(
  userId,
  token,
  { status = "active", limit = 50, max = 5000 } = {}
) {
  const out = [];

  // ✅ blindagem: garante números válidos
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 50));
  const safeMax = Math.max(1, Number(max) || 5000);

  let offset = 0;

  // /users/{user_id}/items/search -> retorna ids
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

    // incrementa SEMPRE com número
    offset = offset + safeLimit;

    if (!ids.length) break;
    if (offset >= total) break;
    if (out.length >= safeMax) break; // proteção
  }

  return out;
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

  async addOrUpdateFromML({ req, res, meli_conta_id, mlb, opts = {} }) {
    const token = getAccessToken(req, res);

    const item = await mlGET(`/items/${encodeURIComponent(mlb)}`, token);
    const inventory_id = item?.inventory_id || null;

    // ✅ se for import de FULL, não queremos poluir a tabela com anúncios não-FULL
    if (!inventory_id && opts.onlyIfFull) {
      return null; // "skipped"
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

    // ✅ IMPORTAR tudo do ML e popular DB (apenas FULL)
    if (String(mode || "").toUpperCase() === "IMPORT_ALL") {
      const me = await getMe(token);
      const userId = me?.id;

      if (!userId) {
        const err = new Error("Não foi possível obter /users/me para importar.");
        err.statusCode = 500;
        err.details = { me };
        throw err;
      }

      // busca itens do vendedor
      const itemIds = await listUserItems(userId, token, {
        status: "active",
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

          await sleep(80); // rate-limit friendly
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

    // ===== MODO SYNC (selecionados ou tudo do DB) =====
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
    const clean = mlbs
      .map((x) => String(x || "").trim().toUpperCase())
      .filter(Boolean);

    const r = await db.query(
      `DELETE FROM anuncios_full WHERE meli_conta_id = $1 AND mlb = ANY($2::text[])`,
      [meli_conta_id, clean]
    );

    return { deleted: r.rowCount || 0 };
  },
};
