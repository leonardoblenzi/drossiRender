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
        return res
          .status(400)
          .json({
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
        return res
          .status(400)
          .json({
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

  async sync(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Conta não selecionada (meli_conta_id ausente).",
          });
      }

      // null => sincroniza tudo do DB
      const mlbs = Array.isArray(req.body?.mlbs) ? req.body.mlbs : null;

      const out = await FullService.sync({ req, res, meli_conta_id, mlbs });
      return res.json({ success: true, ...out });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Erro ao sincronizar FULL",
        message: error.message,
      });
    }
  },

  async bulkDelete(req, res) {
    try {
      const meli_conta_id = pickContaId(req);
      if (!meli_conta_id) {
        return res
          .status(400)
          .json({
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
        return res
          .status(400)
          .json({
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
