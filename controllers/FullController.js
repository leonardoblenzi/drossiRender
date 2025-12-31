"use strict";

const FullService = require("../services/fullService");

function pickContaId(req) {
  const raw = req.cookies?.meli_conta_id;
  const meli_conta_id = Number(raw);
  if (!meli_conta_id || Number.isNaN(meli_conta_id)) return null;
  return meli_conta_id;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMlbs(input) {
  if (!Array.isArray(input)) return null;
  const clean = input
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  return clean.length ? clean : [];
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

      // ✅ blindagem forte contra NaN/strings
      const page = Math.max(1, toInt(req.query.page, 1));
      const pageSize = Math.min(200, Math.max(10, toInt(req.query.pageSize, 25)));

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "all").trim();

      const out = await FullService.list({
        meli_conta_id,
        page,
        pageSize,
        q,
        status,
      });

      return res.json({ success: true, ...out });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: "Erro ao listar FULL",
        message: error.message,
        details: error.details || null,
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

      const mlb = String(req.body?.mlb || "").trim().toUpperCase();
      if (!mlb || !mlb.startsWith("MLB")) {
        return res.status(400).json({
          success: false,
          error: "MLB inválido.",
        });
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

  async sync(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      // ✅ alinhado com o service:
      // - mode: "IMPORT_ALL" -> FullService.sync({ mode: "IMPORT_ALL" })
      // - mlbs: [] -> sync selecionados
      // - mlbs: null -> sync tudo do DB
      const mode = String(req.body?.mode || "").trim().toUpperCase() || null;
      const mlbs = normalizeMlbs(req.body?.mlbs); // null | [] | [..]

      const out = await FullService.sync({
        req,
        res,
        meli_conta_id,
        mlbs: mlbs === null ? null : mlbs, // preserva null corretamente
        mode,
      });

      return res.json({ success: true, ...out });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: "Erro ao sincronizar FULL",
        message: error.message,
        details: error.details || null,
      });
    }
  },

  async bulkDelete(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res.status(400).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlbs = normalizeMlbs(req.body?.mlbs) || [];
      if (!mlbs.length) {
        return res.status(400).json({
          success: false,
          error: "Nenhum MLB informado.",
        });
      }

      const out = await FullService.bulkDelete({ meli_conta_id, mlbs });
      return res.json({ success: true, ...out });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: "Erro ao remover em lote",
        message: error.message,
        details: error.details || null,
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

      const mlb = String(req.params.mlb || "").trim().toUpperCase();
      if (!mlb || !mlb.startsWith("MLB")) {
        return res.status(400).json({
          success: false,
          error: "MLB inválido.",
        });
      }

      const out = await FullService.bulkDelete({
        meli_conta_id,
        mlbs: [mlb],
      });

      return res.json({ success: true, ...out });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        success: false,
        error: "Erro ao remover",
        message: error.message,
        details: error.details || null,
      });
    }
  },
};
