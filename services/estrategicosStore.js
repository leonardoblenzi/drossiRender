// services/estrategicosStore.js
//
// Store em PostgreSQL por conta ML (meli_conta_id) usando a tabela:
//   anuncios_estrategicos
//
// Mantém a mesma API pública do store antigo (JSON) para evitar quebrar o app.
//
// Campos esperados (mínimo):
// - id (bigserial)
// - meli_conta_id (bigint) FK meli_contas(id)
// - mlb (text) UNIQUE (meli_conta_id, mlb)
// - name (text)
// - percent_default (numeric)
// - percent_cycle (numeric)
// - percent_applied (numeric)
// - status (text)
// - listing_status (text)
// - last_applied_at (timestamptz)
// - last_applied_percent (numeric)
// - last_synced_at (timestamptz)
// - created_at / updated_at (timestamptz)

"use strict";

let db;
try {
  db = require("../db/db");
} catch (e) {
  db = require("../db");
}

const TABLE = "anuncios_estrategicos";

function normMlb(mlb) {
  return String(mlb || "")
    .trim()
    .toUpperCase();
}

function toNumOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function toContaId(meliContaId) {
  const n = Number(meliContaId);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("meli_conta_id inválido para EstratégicosStore.");
  }
  return n;
}

function normalizeRow(r = {}) {
  return {
    id: r.id,
    mlb: r.mlb,
    name: r.name || "",
    default_percent:
      r.percent_default != null ? Number(r.percent_default) : null, // compat antigo
    percent_default:
      r.percent_default != null ? Number(r.percent_default) : null,
    percent_cycle: r.percent_cycle != null ? Number(r.percent_cycle) : null,
    percent_applied:
      r.percent_applied != null ? Number(r.percent_applied) : null,
    status: r.status || "",
    listing_status: r.listing_status || null,
    last_applied_at: r.last_applied_at || null,
    last_applied_percent:
      r.last_applied_percent != null ? Number(r.last_applied_percent) : null,
    last_synced_at: r.last_synced_at || null,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  };
}

class EstrategicosStore {
  /**
   * Lista todos os estratégicos da conta.
   * @param {number|string} meliContaId
   * @returns {Promise<Array>}
   */
  static async list(meliContaId) {
    const meli_conta_id = toContaId(meliContaId);

    const r = await db.query(
      `SELECT *
         FROM ${TABLE}
        WHERE meli_conta_id = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC`,
      [meli_conta_id]
    );

    return (r.rows || []).map(normalizeRow);
  }

  /**
   * Salva a lista inteira (substitui).
   * No DB, isso vira um "replace" em transação.
   * @param {number|string} meliContaId
   * @param {Array} items
   */
  static async saveAll(meliContaId, items) {
    const meli_conta_id = toContaId(meliContaId);
    const arr = Array.isArray(items) ? items : [];

    const now = new Date().toISOString();

    // Normaliza e remove vazios
    const norm = arr
      .map((it) => ({
        mlb: normMlb(it?.mlb),
        name: it?.name != null ? String(it.name) : null,
        percent_default:
          it?.percent_default != null
            ? toNumOrNull(it.percent_default)
            : it?.default_percent != null
            ? toNumOrNull(it.default_percent)
            : it?.default_percent === 0
            ? 0
            : null,
      }))
      .filter((x) => x.mlb);

    await db.query("BEGIN");
    try {
      // apaga tudo e insere o novo conjunto
      await db.query(`DELETE FROM ${TABLE} WHERE meli_conta_id = $1`, [
        meli_conta_id,
      ]);

      for (const it of norm) {
        await db.query(
          `
          INSERT INTO ${TABLE} (meli_conta_id, mlb, name, percent_default, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $5)
          `,
          [meli_conta_id, it.mlb, it.name, it.percent_default, now]
        );
      }

      await db.query("COMMIT");
      return true;
    } catch (e) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      throw e;
    }
  }

  /**
   * Adiciona ou atualiza um item (upsert por MLB).
   * @param {number|string} meliContaId
   * @param {{mlb:string,name?:string,default_percent?:number,percent_default?:number}} payload
   * @returns {Promise<object>} item salvo
   */
  static async upsert(meliContaId, payload) {
    const meli_conta_id = toContaId(meliContaId);

    const mlb = normMlb(payload?.mlb);
    if (!mlb) throw new Error("MLB obrigatório para salvar estratégico.");

    const name = payload?.name != null ? String(payload.name).trim() : null;

    // compat: default_percent antigo ou percent_default novo
    const defPct =
      payload?.percent_default != null
        ? toNumOrNull(payload.percent_default)
        : payload?.default_percent != null
        ? toNumOrNull(payload.default_percent)
        : null;

    const r = await db.query(
      `
      INSERT INTO ${TABLE} (meli_conta_id, mlb, name, percent_default, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (meli_conta_id, mlb)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, ${TABLE}.name),
        percent_default = COALESCE(EXCLUDED.percent_default, ${TABLE}.percent_default),
        updated_at = NOW()
      RETURNING *;
      `,
      [meli_conta_id, mlb, name || null, defPct]
    );

    return normalizeRow(r.rows?.[0] || {});
  }

  /**
   * Remove um item da lista pela MLB.
   * @param {number|string} meliContaId
   * @param {string} mlb
   * @returns {Promise<boolean>} true se removeu algo
   */
  static async remove(meliContaId, mlb) {
    const meli_conta_id = toContaId(meliContaId);
    const target = normMlb(mlb);
    if (!target) return false;

    const r = await db.query(
      `DELETE FROM ${TABLE} WHERE meli_conta_id = $1 AND mlb = $2`,
      [meli_conta_id, target]
    );

    return (r.rowCount || 0) > 0;
  }

  /**
   * Atualiza informações de aplicação (quando rodar o job).
   * @param {number|string} meliContaId
   * @param {string} mlb
   * @param {number} appliedPercent
   */
  static async markApplied(meliContaId, mlb, appliedPercent) {
    const meli_conta_id = toContaId(meliContaId);
    const target = normMlb(mlb);
    if (!target) return;

    const pct = appliedPercent != null ? toNumOrNull(appliedPercent) : null;

    await db.query(
      `
      UPDATE ${TABLE}
         SET
           last_applied_at = NOW(),
           last_applied_percent = COALESCE($1, last_applied_percent),
           percent_applied = COALESCE($1, percent_applied),
           updated_at = NOW()
       WHERE meli_conta_id = $2 AND mlb = $3
      `,
      [pct, meli_conta_id, target]
    );
  }

  /**
   * Substitui a lista inteira a partir de uma lista (ex: upload CSV).
   * @param {number|string} meliContaId
   * @param {Array<{mlb:string,name?:string,default_percent?:number,percent_default?:number}>} items
   * @param {boolean} preserveExisting
   *  - true: apenas upsert nos MLBs enviados (mantém os demais)
   *  - false: remove os que não estão no arquivo (substitui)
   * @returns {Promise<Array>} lista final
   */
  static async replaceFromList(meliContaId, items, preserveExisting = false) {
    const meli_conta_id = toContaId(meliContaId);

    const list = Array.isArray(items) ? items : [];
    const mapNew = new Map();

    for (const raw of list) {
      const mlb = normMlb(raw?.mlb);
      if (!mlb) continue;

      const name = raw?.name != null ? String(raw.name).trim() : null;
      const defPct =
        raw?.percent_default != null
          ? toNumOrNull(raw.percent_default)
          : raw?.default_percent != null
          ? toNumOrNull(raw.default_percent)
          : null;

      mapNew.set(mlb, { mlb, name, percent_default: defPct });
    }

    await db.query("BEGIN");
    try {
      if (!preserveExisting) {
        // remove quem não estiver no arquivo
        const mlbs = Array.from(mapNew.keys());
        if (mlbs.length) {
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

      // upsert do arquivo
      for (const it of mapNew.values()) {
        await db.query(
          `
          INSERT INTO ${TABLE} (meli_conta_id, mlb, name, percent_default, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (meli_conta_id, mlb)
          DO UPDATE SET
            name = COALESCE(EXCLUDED.name, ${TABLE}.name),
            percent_default = COALESCE(EXCLUDED.percent_default, ${TABLE}.percent_default),
            updated_at = NOW()
          `,
          [meli_conta_id, it.mlb, it.name, it.percent_default]
        );
      }

      await db.query("COMMIT");
    } catch (e) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      throw e;
    }

    // retorna lista final
    return await EstrategicosStore.list(meli_conta_id);
  }
}

module.exports = EstrategicosStore;
