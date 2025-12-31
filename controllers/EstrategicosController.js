// controllers/EstrategicosController.js
//
// Produtos Estratégicos — PostgreSQL por meli_conta_id
// NOVO MODELO: Preço Original (readonly) -> Preço Promo (editável) -> % calculada (readonly)
// + sync (ID e MLB), apply por promo_price
// + BULK (sync/delete)
// + replace com relatório de duplicados (skipped_existing)
//
// Requerimentos esperados na tabela (anuncios_estrategicos):
// - id, meli_conta_id, mlb, name
// - original_price numeric, promo_price numeric
// - percent_calc numeric, percent_applied numeric
// - listing_status text, status text
// - last_synced_at, created_at, updated_at
//
// Observação: caso seu db.js exporte { query }, isto funciona.
// Se exportar diretamente uma função, ajuste.

"use strict";

const CriarPromocaoService = require("../services/criarPromocaoService");

// DB
let db;
try {
  db = require("../db/db");
} catch (e) {
  db = require("../db");
}

// fetch compatível (Node <18)
const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

// -------------------- Helpers --------------------

const TABLE = "anuncios_estrategicos";

function toNumOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function calcPercentFromPrices(original, promo) {
  const o = Number(original);
  const p = Number(promo);
  if (!Number.isFinite(o) || !Number.isFinite(p) || o <= 0 || p <= 0)
    return null;
  if (p >= o) return 0; // promoção "zero" ou preço promo >= original
  const pct = (1 - p / o) * 100;
  return round2(pct);
}

function ensureContaId(res) {
  const id =
    res?.locals?.mlCreds?.meli_conta_id ??
    res?.locals?.mlCreds?.meliContaId ??
    null;

  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getAccessToken(req, res) {
  const t = req?.ml?.accessToken || req?.ml?.access_token;
  if (t) return t;
  const t2 = res?.locals?.mlCreds?.access_token;
  if (t2) return t2;
  return null;
}

function normalizeRow(r = {}) {
  return {
    id: r.id,
    mlb: r.mlb,
    name: r.name || "",
    original_price: r.original_price != null ? Number(r.original_price) : null,
    promo_price: r.promo_price != null ? Number(r.promo_price) : null,

    // ❌ REMOVIDO: percent_calc não existe no DB (cálculo fica no front)
    // percent_calc: r.percent_calc != null ? Number(r.percent_calc) : null,

    percent_applied:
      r.percent_applied != null ? Number(r.percent_applied) : null,

    status: r.status || "",
    listing_status: r.listing_status || null,
    last_synced_at: r.last_synced_at || null,
    updated_at: r.updated_at || null,
    created_at: r.created_at || null,
  };
}

/** GET JSON com retry simples */
async function httpGetJson(url, headers, retries = 2) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    let r, status, text;
    try {
      r = await fetchRef(url, { headers });
      status = r.status;
      text = await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      continue;
    }

    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise((res) => setTimeout(res, 350 * (i + 1)));
      continue;
    }

    if (!r.ok) {
      lastErr = new Error(
        `GET ${url} -> ${status} :: ${(text || "").slice(0, 200)}`
      );
      break;
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      break;
    }
  }

  throw lastErr || new Error(`Falha em GET ${url}`);
}

/**
 * Busca nome e status do anúncio no ML
 */
async function fetchItemBasics({ token, itemId }) {
  const url = `https://api.mercadolibre.com/items/${encodeURIComponent(
    itemId
  )}?attributes=id,title,status,sub_status,price,original_price`;

  const headers = { Authorization: `Bearer ${token}` };
  const j = await httpGetJson(url, headers, 2);

  // Em muitos casos, `price` é o preço atual (pode estar com promo),
  // `original_price` pode vir preenchido quando há desconto.
  // Se original_price for nulo, vamos tratar original = price (fallback).
  const price = toNumOrNull(j?.price);
  const orig = toNumOrNull(j?.original_price);

  const original_price = orig != null ? orig : price; // fallback
  const current_price = price;

  return {
    title: j?.title || "",
    status: j?.status || null,
    original_price,
    current_price,
  };
}

/**
 * Lê a Prices API do item e tenta inferir promoção ativa agora.
 * Retorna:
 * - active: boolean
 * - promo_price: preço atual promo (se inferido)
 * - original_price: preço base/regular (se inferido)
 * - percent: em 0..1 (se inferido)
 */
async function fetchPromoFromPricesApi({ token, itemId }) {
  const url = `https://api.mercadolibre.com/items/${encodeURIComponent(
    itemId
  )}/prices`;
  const headers = { Authorization: `Bearer ${token}` };

  const nowMs = Date.now();

  const pct = (full, price) => {
    const f = Number(full || 0);
    const p = Number(price || 0);
    if (f > 0 && p > 0 && p < f) return 1 - p / f;
    return null;
  };

  try {
    const j = await httpGetJson(url, headers, 2);

    const buckets = [];
    if (Array.isArray(j?.prices?.prices)) buckets.push(...j.prices.prices);
    if (Array.isArray(j?.prices)) buckets.push(...j.prices);
    if (Array.isArray(j?.reference_prices)) buckets.push(...j.reference_prices);

    const promoNodes = Array.isArray(j?.promotions) ? j.promotions : [];

    const candidates = [];

    // 1) Preços type=promotion dentro da janela
    for (const p of buckets) {
      const t = String(p?.type || "").toLowerCase();
      if (t !== "promotion") continue;

      const df = p?.conditions?.start_time || p?.date_from || p?.start_time;
      const dt = p?.conditions?.end_time || p?.date_to || p?.end_time;

      const inWindow =
        (!df || nowMs >= new Date(df).getTime()) &&
        (!dt || nowMs <= new Date(dt).getTime());

      if (!inWindow) continue;

      const percent = pct(p?.regular_amount, p?.amount);
      if (percent != null && percent > 0) {
        candidates.push({
          percent,
          original_price: toNumOrNull(p?.regular_amount),
          promo_price: toNumOrNull(p?.amount),
        });
      }
    }

    // 2) Nó promotions
    for (const p of promoNodes) {
      const st = String(p?.status || "").toLowerCase();
      const df = p?.date_from || p?.start_time;
      const dt = p?.date_to || p?.end_time;

      const inWindow =
        (!df || nowMs >= new Date(df).getTime()) &&
        (!dt || nowMs <= new Date(dt).getTime());

      const isActive = (st ? st === "active" : true) && inWindow;
      if (!isActive) continue;

      const percent = pct(
        p?.regular_amount || p?.base_price,
        p?.price || p?.amount
      );
      if (percent != null && percent > 0) {
        candidates.push({
          percent,
          original_price: toNumOrNull(p?.regular_amount || p?.base_price),
          promo_price: toNumOrNull(p?.price || p?.amount),
        });
      }
    }

    // 3) Fallback: tenta inferir por qualquer bucket com regular_amount
    const any = (buckets || []).find((x) => x?.amount && x?.regular_amount);
    if (any) {
      const percent = pct(any.regular_amount, any.amount);
      if (percent != null && percent > 0) {
        candidates.push({
          percent,
          original_price: toNumOrNull(any.regular_amount),
          promo_price: toNumOrNull(any.amount),
        });
      }
    }

    if (!candidates.length) {
      return {
        active: false,
        promo_price: null,
        original_price: null,
        percent: null,
      };
    }

    candidates.sort((a, b) => (b.percent || 0) - (a.percent || 0));
    return { active: true, ...candidates[0] };
  } catch {
    return {
      active: false,
      promo_price: null,
      original_price: null,
      percent: null,
    };
  }
}

/**
 * Helper: sync e persiste 1 item por MLB (usado por syncOne e syncByMlb e bulk)
 */
async function syncAndPersistOne({ meli_conta_id, token, row }) {
  const id = row.id;
  const mlb = String(row.mlb || "").toUpperCase();

  // 1) basics (título/status + preço atual/original)
  const basics = await fetchItemBasics({ token, itemId: mlb });

  // 2) promo via prices API (tenta ser mais assertivo)
  const promo = await fetchPromoFromPricesApi({ token, itemId: mlb });

  // Define original_price:
  const original_price =
    basics?.original_price != null
      ? basics.original_price
      : promo?.original_price != null
      ? promo.original_price
      : null;

  // Preço promo "atual" (promo aplicada no ML), se existir:
  const promo_now =
    promo?.active && promo?.promo_price != null ? promo.promo_price : null;

  // percent_applied (em %) se promo ativa e original/promo_now válidos
  let percentApplied = null;
  if (promo_now != null && original_price != null) {
    const p = calcPercentFromPrices(original_price, promo_now);
    percentApplied = p != null ? p : null;
  }

  const statusUi =
    percentApplied != null
      ? `Promoção ativa (${Number(percentApplied).toFixed(2)}%)`
      : "";

  // ❌ REMOVIDO: percent_calc (não existe na tabela)
  const r1 = await db.query(
    `
    UPDATE ${TABLE}
       SET
         name            = COALESCE($1, name),
         listing_status  = COALESCE($2, listing_status),
         original_price  = COALESCE($3, original_price),
         percent_applied = $4,
         status          = COALESCE(NULLIF($5, ''), status),
         last_synced_at  = NOW(),
         updated_at      = NOW()
     WHERE id = $6 AND meli_conta_id = $7
     RETURNING *;
    `,
    [
      basics?.title ? String(basics.title) : null,
      basics?.status ? String(basics.status) : null,
      original_price,
      percentApplied,
      statusUi,
      id,
      meli_conta_id,
    ]
  );

  return normalizeRow(r1.rows[0]);
}

// ====================================================================
// ============================ CONTROLLER ============================
// ====================================================================

class EstrategicosController {
  // GET /api/estrategicos
  static async list(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const r = await db.query(
        `SELECT *
           FROM ${TABLE}
          WHERE meli_conta_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC`,
        [meli_conta_id]
      );

      const items = (r.rows || []).map(normalizeRow);

      return res.json({
        ok: true,
        meli_conta_id,
        total: items.length,
        items,
      });
    } catch (err) {
      console.error("[EstrategicosController.list] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos
  // body: { mlb, promo_price? }
  static async upsert(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const body = req.body || {};
      const mlb = (body.mlb || "").toString().trim().toUpperCase();
      if (!mlb) {
        return res.status(400).json({ ok: false, error: "mlb é obrigatório" });
      }

      const promo_price = toNumOrNull(body.promo_price);

      // Se já existe, retorna 409 (pra front bloquear inserção)
      const exists = await db.query(
        `SELECT id FROM ${TABLE} WHERE meli_conta_id = $1 AND mlb = $2 LIMIT 1`,
        [meli_conta_id, mlb]
      );
      if (exists.rows?.length) {
        return res.status(409).json({
          ok: false,
          code: "DUPLICATE_MLB",
          error: `MLB ${mlb} já existe na lista.`,
          existing_id: exists.rows[0].id,
        });
      }

      const r = await db.query(
        `
        INSERT INTO ${TABLE} (meli_conta_id, mlb, promo_price, updated_at, created_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING *;
        `,
        [meli_conta_id, mlb, promo_price]
      );

      return res.json({ ok: true, item: normalizeRow(r.rows[0]) });
    } catch (err) {
      console.error("[EstrategicosController.upsert] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // PUT /api/estrategicos/:id
  // body: { promo_price? }
  static async update(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "ID inválido." });
      }

      const body = req.body || {};
      const promo_price =
        body.promo_price !== undefined
          ? toNumOrNull(body.promo_price)
          : undefined;

      if (promo_price === undefined) {
        return res.status(400).json({
          ok: false,
          error: "Nada para atualizar (envie promo_price).",
        });
      }

      // ❌ REMOVIDO: SELECT original_price só pra calcular percent_calc
      // (o % é calculado no front agora)

      const r = await db.query(
        `
      UPDATE ${TABLE}
         SET
           promo_price = $1,
           updated_at  = NOW()
       WHERE id = $2 AND meli_conta_id = $3
       RETURNING *;
      `,
        [promo_price, id, meli_conta_id]
      );

      if (!r.rows?.length) {
        return res.status(404).json({
          ok: false,
          error: "Registro não encontrado para esta conta.",
        });
      }

      return res.json({ ok: true, item: normalizeRow(r.rows[0]) });
    } catch (err) {
      console.error("[EstrategicosController.update] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // DELETE /api/estrategicos/:mlb (compat)
  static async remove(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const mlb = (req.params.mlb || "").toString().trim().toUpperCase();
      if (!mlb)
        return res.status(400).json({ ok: false, error: "mlb ausente na URL" });

      const r = await db.query(
        `DELETE FROM ${TABLE} WHERE meli_conta_id = $1 AND mlb = $2`,
        [meli_conta_id, mlb]
      );

      return res.json({ ok: true, removed: r.rowCount || 0 });
    } catch (err) {
      console.error("[EstrategicosController.remove] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // DELETE /api/estrategicos/id/:id
  static async removeById(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "ID inválido." });
      }

      const r = await db.query(
        `DELETE FROM ${TABLE} WHERE meli_conta_id = $1 AND id = $2`,
        [meli_conta_id, id]
      );

      return res.json({ ok: true, removed: r.rowCount || 0 });
    } catch (err) {
      console.error("[EstrategicosController.removeById] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/replace
  // body: { items:[{ mlb, promo_price? }], remove_missing?: boolean }
  static async replace(req, res) {
    const meli_conta_id = ensureContaId(res);
    if (!meli_conta_id) {
      return res.status(401).json({
        ok: false,
        error: "Conta do ML não selecionada (meli_conta_id ausente).",
      });
    }

    const body = req.body || {};
    const list = Array.isArray(body.items) ? body.items : [];
    const removeMissing =
      String(body.remove_missing || "0") === "1" ||
      body.remove_missing === true;

    const norm = list
      .map((raw) => ({
        mlb: (raw.mlb || "").toString().trim().toUpperCase(),
        promo_price: toNumOrNull(raw.promo_price),
      }))
      .filter((x) => x.mlb);

    // Relatório de duplicados:
    const skipped_existing = [];
    const inserted = [];
    const updated = [];

    try {
      await db.query("BEGIN");

      if (removeMissing) {
        if (norm.length) {
          const mlbs = norm.map((x) => x.mlb);
          await db.query(
            `DELETE FROM ${TABLE}
              WHERE meli_conta_id = $1
                AND mlb <> ALL($2::text[])`,
            [meli_conta_id, mlbs]
          );
        } else {
          await db.query(`DELETE FROM ${TABLE} WHERE meli_conta_id = $1`, [
            meli_conta_id,
          ]);
        }
      }

      for (const it of norm) {
        // Se existir, atualiza promo_price (se veio preenchido) e marca como "updated"
        const ex = await db.query(
          `SELECT id FROM ${TABLE} WHERE meli_conta_id=$1 AND mlb=$2 LIMIT 1`,
          [meli_conta_id, it.mlb]
        );

        if (ex.rows?.length) {
          skipped_existing.push(it.mlb);

          // Aqui é uma decisão: você pediu "não deixar inserir se já existe".
          // No replace, normalmente o comportamento é "atualizar se existe".
          // Para seguir seu pedido, vamos NÃO atualizar automaticamente, só reportar.
          // Se quiser atualizar quando existe, eu ajusto.
          continue;
        }

        const r = await db.query(
          `
          INSERT INTO ${TABLE} (meli_conta_id, mlb, promo_price, updated_at, created_at)
          VALUES ($1, $2, $3, NOW(), NOW())
          RETURNING *;
          `,
          [meli_conta_id, it.mlb, it.promo_price]
        );

        inserted.push(it.mlb);
      }

      await db.query("COMMIT");

      const rFinal = await db.query(
        `SELECT * FROM ${TABLE} WHERE meli_conta_id = $1 ORDER BY updated_at DESC NULLS LAST, id DESC`,
        [meli_conta_id]
      );

      return res.json({
        ok: true,
        total: rFinal.rows.length,
        items: rFinal.rows.map(normalizeRow),
        report: {
          inserted,
          updated,
          skipped_existing,
        },
      });
    } catch (err) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      console.error("[EstrategicosController.replace] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/:id/sync
  static async syncOne(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const token = getAccessToken(req, res);
      if (!token) {
        return res.status(401).json({
          ok: false,
          error: "Token ML ausente (authMiddleware não injetou accessToken).",
        });
      }

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "ID inválido." });
      }

      const r0 = await db.query(
        `SELECT * FROM ${TABLE} WHERE id = $1 AND meli_conta_id = $2`,
        [id, meli_conta_id]
      );
      if (!r0.rows?.length) {
        return res.status(404).json({
          ok: false,
          error: "Registro não encontrado para esta conta.",
        });
      }

      const updated = await syncAndPersistOne({
        meli_conta_id,
        token,
        row: r0.rows[0],
      });

      return res.json({ ok: true, item: updated });
    } catch (err) {
      console.error("[EstrategicosController.syncOne] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/:mlb/sync (compat)
  static async syncByMlb(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const token = getAccessToken(req, res);
      if (!token) {
        return res.status(401).json({
          ok: false,
          error: "Token ML ausente (authMiddleware não injetou accessToken).",
        });
      }

      const mlb = (req.params.mlb || "").toString().trim().toUpperCase();
      if (!mlb)
        return res.status(400).json({ ok: false, error: "MLB inválido." });

      const r0 = await db.query(
        `SELECT * FROM ${TABLE} WHERE meli_conta_id=$1 AND mlb=$2 LIMIT 1`,
        [meli_conta_id, mlb]
      );
      if (!r0.rows?.length) {
        return res
          .status(404)
          .json({ ok: false, error: "MLB não encontrado na lista." });
      }

      const updated = await syncAndPersistOne({
        meli_conta_id,
        token,
        row: r0.rows[0],
      });

      return res.json({ ok: true, item: updated });
    } catch (err) {
      console.error("[EstrategicosController.syncByMlb] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/sync
  // body opcional: { ids?: number[], limit?: number }
  static async syncAll(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const token = getAccessToken(req, res);
      if (!token) {
        return res.status(401).json({
          ok: false,
          error: "Token ML ausente (authMiddleware não injetou accessToken).",
        });
      }

      const body = req.body || {};
      const limit = Number(body.limit || 0);
      const ids = Array.isArray(body.ids)
        ? body.ids
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : null;

      let q = `SELECT * FROM ${TABLE} WHERE meli_conta_id = $1`;
      const params = [meli_conta_id];

      if (ids && ids.length) {
        q += ` AND id = ANY($2::bigint[])`;
        params.push(ids);
      }

      q += ` ORDER BY updated_at DESC NULLS LAST, id DESC`;
      if (limit > 0) q += ` LIMIT ${Math.min(limit, 2000)}`;

      const r = await db.query(q, params);
      const rows = r.rows || [];

      const items = [];
      let okCount = 0;

      for (const row of rows) {
        try {
          const upd = await syncAndPersistOne({ meli_conta_id, token, row });
          items.push(upd);
          okCount++;
        } catch (e) {
          items.push({
            ...normalizeRow(row),
            status: `Erro ao sincronizar: ${e.message || String(e)}`,
          });
        }
      }

      return res.json({
        ok: true,
        total: rows.length,
        synced_ok: okCount,
        items,
      });
    } catch (err) {
      console.error("[EstrategicosController.syncAll] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/apply
  // body: { promotion_type, items: [{ mlb, promo_price }] }
  // POST /api/estrategicos/apply
  // body: { promotion_type, items: [{ mlb, promo_price, percent_calc? }] }
  // - percent_calc vem do FRONT (ex: 27.35) e tem prioridade
  // - fallback: calcula % por (original_price vs promo_price)
  static async apply(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const { promotion_type, items } = req.body || {};
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({
          ok: false,
          error: 'Informe "items": [{ mlb, promo_price, percent_calc? }]',
        });
      }

      const t = String(promotion_type || "DEAL").toUpperCase();

      // normaliza itens (aceita percent_calc do front)
      const list = items
        .map((r) => ({
          mlb: (r.mlb || "").toString().trim().toUpperCase(),
          promo_price: toNumOrNull(r.promo_price),
          percent_calc: toNumOrNull(r.percent_calc), // ✅ novo
        }))
        .filter((r) => r.mlb);

      // valida mínimo: precisa ter promo_price > 0 (como antes)
      const listValidPromo = list.filter(
        (r) => r.promo_price != null && r.promo_price > 0
      );

      if (!listValidPromo.length) {
        return res.status(400).json({
          ok: false,
          error: "Nenhum item válido (mlb + promo_price > 0).",
        });
      }

      const options = {
        mlCreds: res.locals?.mlCreds || {},
        accountKey: res.locals?.accountKey,
        logger: console,
      };

      const results = [];
      let okCount = 0;

      for (const it of listValidPromo) {
        try {
          const r0 = await db.query(
            `SELECT * FROM ${TABLE} WHERE meli_conta_id=$1 AND mlb=$2 LIMIT 1`,
            [meli_conta_id, it.mlb]
          );

          if (!r0.rows?.length) {
            results.push({
              mlb: it.mlb,
              promo_price: it.promo_price,
              success: false,
              error: "MLB não encontrado no DB (adicione antes).",
            });
            continue;
          }

          const row = r0.rows[0];
          const original_price =
            row.original_price != null ? Number(row.original_price) : null;

          if (original_price == null || original_price <= 0) {
            results.push({
              mlb: it.mlb,
              promo_price: it.promo_price,
              success: false,
              error:
                "Preço Original ausente. Clique em “Atualizar” (sync) antes de aplicar.",
            });
            continue;
          }

          if (Number(it.promo_price) >= Number(original_price)) {
            results.push({
              mlb: it.mlb,
              promo_price: it.promo_price,
              success: false,
              error: "Preço Promo deve ser menor que o Preço Original.",
            });
            continue;
          }

          // =====================================================
          // ✅ PRIORIDADE: percent_calc vindo do FRONT (em %)
          // =====================================================
          let percentToApply = null;

          const frontPct = it.percent_calc;
          if (
            frontPct != null &&
            Number.isFinite(Number(frontPct)) &&
            Number(frontPct) > 0 &&
            Number(frontPct) < 100
          ) {
            // Usa o que veio do front
            percentToApply = round2(frontPct);
          } else {
            // fallback (comportamento antigo): calcula por preços
            percentToApply = calcPercentFromPrices(
              original_price,
              it.promo_price
            );
          }

          if (
            percentToApply == null ||
            !Number.isFinite(Number(percentToApply))
          ) {
            results.push({
              mlb: it.mlb,
              promo_price: it.promo_price,
              success: false,
              error:
                "Não foi possível determinar a % para aplicar (percent_calc inválida e fallback falhou).",
            });
            continue;
          }

          // sanity check final: não deixa 0 ou >=100
          if (Number(percentToApply) <= 0 || Number(percentToApply) >= 100) {
            results.push({
              mlb: it.mlb,
              promo_price: it.promo_price,
              success: false,
              error: `Percentual inválido para aplicar: ${percentToApply}.`,
            });
            continue;
          }

          const out = await CriarPromocaoService.aplicarDescontoUnico(
            it.mlb,
            percentToApply,
            options
          );

          const success = !!out?.success;
          if (success) okCount++;

          await db.query(
            `
          UPDATE ${TABLE}
             SET
               promo_price     = $1,
               percent_applied = CASE WHEN $2 THEN $3 ELSE percent_applied END,
               status          = $4,
               updated_at      = NOW()
           WHERE meli_conta_id = $5 AND mlb = $6
          `,
            [
              it.promo_price,
              success,
              percentToApply,
              success ? "Promoção aplicada" : "Falha na aplicação",
              meli_conta_id,
              it.mlb,
            ]
          );

          results.push({
            mlb: it.mlb,
            promo_price: it.promo_price,
            percent_to_apply: percentToApply,
            // só pra debug/visibilidade:
            used_front_percent:
              it.percent_calc != null &&
              percentToApply === round2(it.percent_calc),
            success,
            response: out,
          });
        } catch (errApply) {
          console.error(
            "[EstrategicosController.apply] Erro em",
            it.mlb,
            errApply
          );
          results.push({
            mlb: it.mlb,
            promo_price: it.promo_price,
            success: false,
            error: errApply.message || String(errApply),
          });
        }
      }

      return res.json({
        ok: true,
        promotion_type: t,
        total: listValidPromo.length,
        applied_ok: okCount,
        results,
        message: `Aplicação finalizada. Sucesso em ${okCount}/${listValidPromo.length}.`,
      });
    } catch (err) {
      console.error("[EstrategicosController.apply] Erro geral:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // ======================================================
  // ======================= BULK =========================
  // ======================================================

  // POST /api/estrategicos/bulk/sync
  // body: { all?: boolean, ids?: number[], mlbs?: string[], limit?: number }
  static async bulkSync(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const token = getAccessToken(req, res);
      if (!token) {
        return res.status(401).json({
          ok: false,
          error: "Token ML ausente (authMiddleware não injetou accessToken).",
        });
      }

      const body = req.body || {};
      const all = body.all === true || String(body.all) === "1";
      const limit = Math.min(Math.max(Number(body.limit || 0), 0), 5000);

      const ids = Array.isArray(body.ids)
        ? body.ids
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const mlbs = Array.isArray(body.mlbs)
        ? body.mlbs
            .map((s) =>
              String(s || "")
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
        : [];

      let q = `SELECT * FROM ${TABLE} WHERE meli_conta_id=$1`;
      const params = [meli_conta_id];

      if (!all) {
        if (ids.length) {
          q += ` AND id = ANY($2::bigint[])`;
          params.push(ids);
        } else if (mlbs.length) {
          q += ` AND mlb = ANY($2::text[])`;
          params.push(mlbs);
        } else {
          return res.status(400).json({
            ok: false,
            error: "Informe all=true ou ids[] ou mlbs[].",
          });
        }
      }

      q += ` ORDER BY updated_at DESC NULLS LAST, id DESC`;
      if (limit > 0) q += ` LIMIT ${limit}`;

      const r = await db.query(q, params);
      const rows = r.rows || [];

      const items = [];
      let okCount = 0;
      let errCount = 0;

      for (const row of rows) {
        try {
          const upd = await syncAndPersistOne({ meli_conta_id, token, row });
          items.push(upd);
          okCount++;
        } catch (e) {
          errCount++;
          items.push({
            ...normalizeRow(row),
            status: `Erro ao sincronizar: ${e.message || String(e)}`,
          });
        }
      }

      return res.json({
        ok: true,
        total: rows.length,
        synced_ok: okCount,
        synced_err: errCount,
        items,
      });
    } catch (err) {
      console.error("[EstrategicosController.bulkSync] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/bulk/delete
  // body: { all?: boolean, ids?: number[], mlbs?: string[], confirm_all?: boolean }
  static async bulkDelete(req, res) {
    try {
      const meli_conta_id = ensureContaId(res);
      if (!meli_conta_id) {
        return res.status(401).json({
          ok: false,
          error: "Conta do ML não selecionada (meli_conta_id ausente).",
        });
      }

      const body = req.body || {};
      const all = body.all === true || String(body.all) === "1";
      const confirmAll =
        body.confirm_all === true || String(body.confirm_all) === "1";

      const ids = Array.isArray(body.ids)
        ? body.ids
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const mlbs = Array.isArray(body.mlbs)
        ? body.mlbs
            .map((s) =>
              String(s || "")
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
        : [];

      if (all) {
        if (!confirmAll) {
          return res.status(400).json({
            ok: false,
            error: "Para all=true, envie também confirm_all=true (proteção).",
          });
        }
        const r = await db.query(
          `DELETE FROM ${TABLE} WHERE meli_conta_id=$1`,
          [meli_conta_id]
        );
        return res.json({ ok: true, removed: r.rowCount || 0, mode: "all" });
      }

      if (!ids.length && !mlbs.length) {
        return res.status(400).json({
          ok: false,
          error: "Informe ids[] ou mlbs[] ou all=true.",
        });
      }

      let r;
      if (ids.length) {
        r = await db.query(
          `DELETE FROM ${TABLE} WHERE meli_conta_id=$1 AND id = ANY($2::bigint[])`,
          [meli_conta_id, ids]
        );
      } else {
        r = await db.query(
          `DELETE FROM ${TABLE} WHERE meli_conta_id=$1 AND mlb = ANY($2::text[])`,
          [meli_conta_id, mlbs]
        );
      }

      return res.json({
        ok: true,
        removed: r.rowCount || 0,
        mode: ids.length ? "ids" : "mlbs",
      });
    } catch (err) {
      console.error("[EstrategicosController.bulkDelete] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }
}

module.exports = EstrategicosController;
