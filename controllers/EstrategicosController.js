// controllers/EstrategicosController.js
//
// Produtos Estratégicos — Persistência em PostgreSQL (Render) por meli_conta_id
// + integração com CriarPromocaoService para aplicar promoções
// + sync de nome/% aplicada/status direto da API do Mercado Livre
//
// Tabela: anuncios_estrategicos

"use strict";

const CriarPromocaoService = require("../services/criarPromocaoService");

// DB (padrão: module.exports = { query } em ../db/db.js)
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

function ensureContaId(res) {
  // preferências comuns do seu projeto
  const id =
    res?.locals?.mlCreds?.meli_conta_id ??
    res?.locals?.mlCreds?.meliContaId ??
    res?.locals?.meli_conta_id ??
    res?.locals?.meliContaId ??
    null;

  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getAccessToken(req, res) {
  // preferir o que authMiddleware injeta
  const t = req?.ml?.accessToken || req?.ml?.access_token;
  if (t) return t;

  // fallback: ensureAccount injeta res.locals.mlCreds
  const t2 = res?.locals?.mlCreds?.access_token;
  if (t2) return t2;

  return null;
}

function normalizeRow(r = {}) {
  return {
    id: r.id,
    mlb: r.mlb,
    name: r.name || r.nome_produto || "",
    percent_default:
      r.percent_default != null ? Number(r.percent_default) : null,
    percent_cycle: r.percent_cycle != null ? Number(r.percent_cycle) : null,
    percent_applied:
      r.percent_applied != null ? Number(r.percent_applied) : null,
    status: r.status || "",
    listing_status: r.listing_status || r.status_anuncio || null,
    last_synced_at: r.last_synced_at || r.ultimo_sync_em || null,
    updated_at: r.updated_at || r.atualizado_em || null,
    created_at: r.created_at || r.criado_em || null,
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
 * Lê a Prices API do item e tenta inferir promoção ativa “agora”.
 * Retorna percent em 0..1
 */
async function fetchItemPromoNow({ token, itemId }) {
  const url = `https://api.mercadolibre.com/items/${encodeURIComponent(
    itemId
  )}/prices`;
  const headers = { Authorization: `Bearer ${token}` };

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

    const nowMs = Date.now();
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
      if (percent !== null && percent > 0) {
        candidates.push({ active: true, percent });
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
      if (percent !== null && percent > 0) {
        candidates.push({ active: true, percent });
      }
    }

    // 3) Fallback inferred
    const anyPrice = (buckets || []).find((x) => x?.amount);
    if (anyPrice && anyPrice?.regular_amount) {
      const percent = pct(anyPrice.regular_amount, anyPrice.amount);
      if (percent !== null && percent > 0) {
        candidates.push({ active: true, percent });
      }
    }

    if (!candidates.length) return { active: false, percent: null };

    candidates.sort((a, b) => (b.percent || 0) - (a.percent || 0));
    return { active: true, percent: candidates[0].percent };
  } catch {
    return { active: false, percent: null };
  }
}

/** Busca nome e status do anúncio no ML */
async function fetchItemBasics({ token, itemId }) {
  // manter simples/robusto: sem depender do parâmetro attributes
  const url = `https://api.mercadolibre.com/items/${encodeURIComponent(
    itemId
  )}`;
  const headers = { Authorization: `Bearer ${token}` };
  const j = await httpGetJson(url, headers, 2);

  return {
    title: j?.title || "",
    status: j?.status || null, // active/paused/closed...
    sub_status: Array.isArray(j?.sub_status) ? j.sub_status : null,
  };
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
  // body: { mlb, name?, percent_default? }
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

      // importante: quando não vier, NÃO sobrescreve
      const hasName = Object.prototype.hasOwnProperty.call(body, "name");
      const hasPct = Object.prototype.hasOwnProperty.call(
        body,
        "percent_default"
      );

      const name = hasName ? (body.name || "").toString() : null;
      const percent_default = hasPct ? toNumOrNull(body.percent_default) : null;

      // flags para update condicional
      const shouldSetName = hasName && String(name || "").trim() !== "";
      const shouldSetPct = hasPct; // se veio, pode até ser null (limpar)

      const r = await db.query(
        `
        INSERT INTO ${TABLE} (meli_conta_id, mlb, name, percent_default, updated_at, created_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (meli_conta_id, mlb)
        DO UPDATE SET
          name = CASE WHEN $5 THEN EXCLUDED.name ELSE ${TABLE}.name END,
          percent_default = CASE WHEN $6 THEN EXCLUDED.percent_default ELSE ${TABLE}.percent_default END,
          updated_at = NOW()
        RETURNING *;
        `,
        [
          meli_conta_id,
          mlb,
          shouldSetName ? name : null,
          shouldSetPct ? percent_default : null,
          shouldSetName,
          shouldSetPct,
        ]
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
  // body: { percent_default?, name? }
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

      const hasPct = Object.prototype.hasOwnProperty.call(
        body,
        "percent_default"
      );
      const hasName = Object.prototype.hasOwnProperty.call(body, "name");

      if (!hasPct && !hasName) {
        return res.status(400).json({
          ok: false,
          error: "Nada para atualizar (envie percent_default e/ou name).",
        });
      }

      const pctVal = hasPct ? toNumOrNull(body.percent_default) : null;
      // se enviar name como "" a gente limpa (vira NULL) pra manter UI limpa
      const nameVal = hasName ? String(body.name || "").trim() : null;
      const nameToSet = hasName ? (nameVal ? nameVal : null) : null;

      const r = await db.query(
        `
        UPDATE ${TABLE}
           SET
             percent_default = CASE WHEN $1 THEN $2 ELSE percent_default END,
             name            = CASE WHEN $3 THEN $4 ELSE name END,
             updated_at      = NOW()
         WHERE id = $5 AND meli_conta_id = $6
         RETURNING *;
        `,
        [hasPct, pctVal, hasName, nameToSet, id, meli_conta_id]
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
      if (!mlb) {
        return res.status(400).json({ ok: false, error: "mlb ausente na URL" });
      }

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
  // body: { items:[{ mlb, name?, percent_default? }], remove_missing?: boolean }
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
        name: (raw.name || "").toString().trim(),
        percent_default: toNumOrNull(raw.percent_default),
      }))
      .filter((x) => x.mlb);

    try {
      await db.query("BEGIN");

      if (removeMissing) {
        if (norm.length) {
          const mlbs = norm.map((x) => x.mlb);
          // remove tudo que NÃO está na lista
          await db.query(
            `
            DELETE FROM ${TABLE}
             WHERE meli_conta_id = $1
               AND NOT (mlb = ANY($2::text[]))
            `,
            [meli_conta_id, mlbs]
          );
        } else {
          await db.query(`DELETE FROM ${TABLE} WHERE meli_conta_id = $1`, [
            meli_conta_id,
          ]);
        }
      }

      for (const it of norm) {
        const hasName = it.name !== "";
        const hasPct = Object.prototype.hasOwnProperty.call(
          it,
          "percent_default"
        );

        await db.query(
          `
          INSERT INTO ${TABLE} (meli_conta_id, mlb, name, percent_default, updated_at, created_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (meli_conta_id, mlb)
          DO UPDATE SET
            name = CASE WHEN $5 THEN EXCLUDED.name ELSE ${TABLE}.name END,
            percent_default = CASE WHEN $6 THEN EXCLUDED.percent_default ELSE ${TABLE}.percent_default END,
            updated_at = NOW();
          `,
          [
            meli_conta_id,
            it.mlb,
            hasName ? it.name : null,
            it.percent_default,
            hasName,
            hasPct,
          ]
        );
      }

      await db.query("COMMIT");

      const r = await db.query(
        `SELECT * FROM ${TABLE}
          WHERE meli_conta_id = $1
          ORDER BY updated_at DESC NULLS LAST, id DESC`,
        [meli_conta_id]
      );

      return res.json({
        ok: true,
        total: r.rows.length,
        items: r.rows.map(normalizeRow),
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

      const row = r0.rows[0];
      const mlb = String(row.mlb || "").toUpperCase();

      const basics = await fetchItemBasics({ token, itemId: mlb });
      const promo = await fetchItemPromoNow({ token, itemId: mlb });

      const percentApplied100 =
        promo?.active && promo?.percent != null
          ? Number(promo.percent) * 100
          : null;

      const statusUi =
        promo?.active && percentApplied100 != null
          ? `Promoção ativa (${percentApplied100.toFixed(2)}%)`
          : "";

      const r1 = await db.query(
        `
        UPDATE ${TABLE}
           SET
             name = COALESCE($1, name),
             listing_status = COALESCE($2, listing_status),
             percent_applied = $3,
             status = CASE WHEN NULLIF($4, '') IS NOT NULL THEN $4 ELSE status END,
             last_synced_at = NOW(),
             updated_at = NOW()
         WHERE id = $5 AND meli_conta_id = $6
         RETURNING *;
        `,
        [
          basics?.title ? String(basics.title) : null,
          basics?.status ? String(basics.status) : null,
          percentApplied100,
          statusUi,
          id,
          meli_conta_id,
        ]
      );

      return res.json({ ok: true, item: normalizeRow(r1.rows[0]) });
    } catch (err) {
      console.error("[EstrategicosController.syncOne] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/:mlb/sync  (compat com front/versões antigas)
  // Faz sync usando MLB (e cria registro se não existir)
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
      if (!mlb) {
        return res.status(400).json({ ok: false, error: "mlb ausente na URL" });
      }

      // garante que existe registro pra esta conta
      const r0 = await db.query(
        `SELECT * FROM ${TABLE} WHERE meli_conta_id = $1 AND mlb = $2 LIMIT 1`,
        [meli_conta_id, mlb]
      );

      let id;
      if (r0.rows?.length) {
        id = r0.rows[0].id;
      } else {
        const rIns = await db.query(
          `
          INSERT INTO ${TABLE} (meli_conta_id, mlb, updated_at, created_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (meli_conta_id, mlb)
          DO UPDATE SET updated_at = NOW()
          RETURNING *;
          `,
          [meli_conta_id, mlb]
        );
        id = rIns.rows[0].id;
      }

      // reaproveita lógica de syncOne (sem duplicar)
      req.params.id = String(id);
      return EstrategicosController.syncOne(req, res);
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
      if (limit > 0) q += ` LIMIT ${Math.min(limit, 500)}`;

      const r = await db.query(q, params);
      const rows = r.rows || [];

      const updated = [];
      let okCount = 0;

      for (const row of rows) {
        const id = row.id;
        const mlb = String(row.mlb || "").toUpperCase();

        try {
          const basics = await fetchItemBasics({ token, itemId: mlb });
          const promo = await fetchItemPromoNow({ token, itemId: mlb });

          const percentApplied100 =
            promo?.active && promo?.percent != null
              ? Number(promo.percent) * 100
              : null;

          const statusUi =
            promo?.active && percentApplied100 != null
              ? `Promoção ativa (${percentApplied100.toFixed(2)}%)`
              : "";

          const r1 = await db.query(
            `
            UPDATE ${TABLE}
               SET
                 name = COALESCE($1, name),
                 listing_status = COALESCE($2, listing_status),
                 percent_applied = $3,
                 status = CASE WHEN NULLIF($4, '') IS NOT NULL THEN $4 ELSE status END,
                 last_synced_at = NOW(),
                 updated_at = NOW()
             WHERE id = $5 AND meli_conta_id = $6
             RETURNING *;
            `,
            [
              basics?.title ? String(basics.title) : null,
              basics?.status ? String(basics.status) : null,
              percentApplied100,
              statusUi,
              id,
              meli_conta_id,
            ]
          );

          updated.push(normalizeRow(r1.rows[0]));
          okCount++;
        } catch (e) {
          updated.push({
            ...normalizeRow(row),
            status: `Erro ao sincronizar: ${e.message || String(e)}`,
          });
        }
      }

      return res.json({
        ok: true,
        total: rows.length,
        synced_ok: okCount,
        items: updated,
      });
    } catch (err) {
      console.error("[EstrategicosController.syncAll] Erro:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/apply
  // body: { promotion_type, items: [{ mlb, percent }] }
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
        return res
          .status(400)
          .json({ ok: false, error: 'Informe "items": [{ mlb, percent }]' });
      }

      const t = String(promotion_type || "DEAL").toUpperCase();

      const list = items
        .map((r) => ({
          mlb: (r.mlb || "").toString().trim().toUpperCase(),
          percent: toNumOrNull(r.percent),
        }))
        .filter((r) => r.mlb && r.percent != null && r.percent > 0);

      if (!list.length) {
        return res.status(400).json({
          ok: false,
          error: "Nenhum item válido (mlb + percent > 0).",
        });
      }

      const options = {
        mlCreds: res.locals?.mlCreds || {},
        accountKey: res.locals?.accountKey,
        promotionType: t,
        promotion_type: t,
        logger: console,
      };

      const results = [];
      let okCount = 0;

      for (const it of list) {
        try {
          const out = await CriarPromocaoService.aplicarDescontoUnico(
            it.mlb,
            it.percent,
            options
          );
          const success = !!out?.success;
          if (success) okCount++;

          // Atualiza no DB (upsert por (meli_conta_id, mlb))
          // - percent_cycle sempre atualiza (tentativa atual)
          // - percent_applied só atualiza se success
          // - percent_default: se já existe, mantém; se não existe, define (evita sobrescrever default do usuário)
          await db.query(
            `
            INSERT INTO ${TABLE}
              (meli_conta_id, mlb, percent_default, percent_cycle, percent_applied, status, updated_at, created_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (meli_conta_id, mlb)
            DO UPDATE SET
              percent_default = COALESCE(${TABLE}.percent_default, EXCLUDED.percent_default),
              percent_cycle   = EXCLUDED.percent_cycle,
              percent_applied = CASE WHEN $7 THEN EXCLUDED.percent_applied ELSE ${TABLE}.percent_applied END,
              status          = EXCLUDED.status,
              updated_at      = NOW();
            `,
            [
              meli_conta_id,
              it.mlb,
              it.percent, // default (só entra se ainda não existir)
              it.percent, // cycle
              it.percent, // applied (quando success)
              success ? "Promoção aplicada" : "Falha na aplicação",
              success,
            ]
          );

          results.push({
            mlb: it.mlb,
            percent: it.percent,
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
            percent: it.percent,
            success: false,
            error: errApply.message || String(errApply),
          });
        }
      }

      return res.json({
        ok: true,
        promotion_type: t,
        total: list.length,
        applied_ok: okCount,
        results,
        message: `Aplicação de promoção finalizada. Sucesso em ${okCount}/${list.length}.`,
      });
    } catch (err) {
      console.error("[EstrategicosController.apply] Erro geral:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || String(err) });
    }
  }
}

module.exports = EstrategicosController;
