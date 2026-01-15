"use strict";

const { updatePrazoProducao } = require("../services/prazoProducaoService");
const {
  enqueuePrazoJob,
  getPrazoJobStatus,
} = require("../services/prazoProducaoQueueService");

function pickAccessToken(req) {
  const t = req?.ml?.accessToken;
  if (!t) {
    const err = new Error("Token ML ausente em req.ml.accessToken.");
    err.statusCode = 401;
    throw err;
  }
  return t;
}

async function setPrazoProducaoSingle(req, res) {
  try {
    const accessToken = pickAccessToken(req);
    const { mlb_id, days } = req.body || {};

    const out = await updatePrazoProducao({
      accessToken,
      mlbId: mlb_id,
      days,
      verify: true,
    });

    res.json(out);
  } catch (e) {
    res.status(e.statusCode || 400).json({
      success: false,
      error: e.message || "Falha",
      details: e.details || null,
    });
  }
}

async function setPrazoProducaoLote(req, res) {
  try {
    const accessToken = pickAccessToken(req);
    const { mlb_ids, days, delayMs } = req.body || {};

    if (!Array.isArray(mlb_ids) || mlb_ids.length === 0) {
      return res.status(400).json({ success: false, error: "mlb_ids vazio" });
    }

    const process_id = await enqueuePrazoJob({
      accessToken,
      mlb_ids,
      days,
      delayMs: delayMs ?? 250,
    });

    res.json({ success: true, process_id });
  } catch (e) {
    res.status(e.statusCode || 400).json({
      success: false,
      error: e.message || "Falha",
      details: e.details || null,
    });
  }
}

async function statusPrazoProducao(req, res) {
  try {
    const id = req.params.id;
    const st = await getPrazoJobStatus(id);
    if (!st) return res.status(404).json({ error: "processo não encontrado" });
    res.json(st);
  } catch (e) {
    res.status(500).json({ error: e.message || "Falha" });
  }
}

module.exports = {
  setPrazoProducaoSingle,
  setPrazoProducaoLote,
  statusPrazoProducao,
};
