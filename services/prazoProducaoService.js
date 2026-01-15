"use strict";

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normMlb(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (!/^MLB\d{6,}$/.test(s)) return null;
  return s;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

async function mlGetItem({ accessToken, mlbId }) {
  const url = `https://api.mercadolibre.com/items/${mlbId}`;
  const r = await fetchRef(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      data?.message || data?.error || `Falha ao buscar item (${r.status})`;
    const err = new Error(msg);
    err.statusCode = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

function upsertManufacturingSaleTerm(saleTerms = [], days) {
  const next = Array.isArray(saleTerms) ? [...saleTerms] : [];
  const id = "MANUFACTURING_TIME";

  const payloadTerm = {
    id,
    value_name: `${days} dias`,
    value_struct: { number: days, unit: "dias" },
  };

  const idx = next.findIndex((t) => String(t?.id || "").toUpperCase() === id);
  if (idx >= 0) next[idx] = { ...next[idx], ...payloadTerm };
  else next.push(payloadTerm);

  return next;
}

async function mlPutSaleTerms({ accessToken, mlbId, saleTerms }) {
  const url = `https://api.mercadolibre.com/items/${mlbId}`;

  const r = await fetchRef(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ sale_terms: saleTerms }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      data?.message || data?.error || `Falha ao atualizar item (${r.status})`;
    const err = new Error(msg);
    err.statusCode = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

/**
 * Atualiza manufacturing time (MANUFACTURING_TIME) sem destruir outros sale_terms:
 * - GET item
 * - merge sale_terms
 * - PUT item
 * - (opcional) GET de verificação
 */
async function updatePrazoProducao({
  accessToken,
  mlbId,
  days,
  verify = true,
}) {
  const id = normMlb(mlbId);
  if (!id) throw new Error("MLB inválido");
  const d = clampInt(days, 0, 365); // ajuste se quiser (0..365)
  if (d == null) throw new Error("Dias inválidos");

  const before = await mlGetItem({ accessToken, mlbId: id });
  const beforeTerms = before.sale_terms || [];
  const beforeTerm =
    (beforeTerms || []).find((t) => t?.id === "MANUFACTURING_TIME") || null;

  const merged = upsertManufacturingSaleTerm(beforeTerms, d);
  const putRes = await mlPutSaleTerms({
    accessToken,
    mlbId: id,
    saleTerms: merged,
  });

  let after = null;
  let afterTerm = null;
  if (verify) {
    await sleep(250); // micro-pausa
    after = await mlGetItem({ accessToken, mlbId: id });
    afterTerm =
      (after.sale_terms || []).find((t) => t?.id === "MANUFACTURING_TIME") ||
      null;
  }

  return {
    success: true,
    mlb_id: id,
    title: before?.title || putRes?.title || null,
    manufacturing_before: beforeTerm,
    manufacturing_after: afterTerm,
    put_result: putRes,
  };
}

module.exports = {
  updatePrazoProducao,
  normMlb,
  clampInt,
};
