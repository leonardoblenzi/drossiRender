// controllers/FullController.js
"use strict";

const FullService = require("../services/fullService");

// Helpers
function pickAccountId(res, req) {
  // novo padrão: ensureAccount injeta mlCreds + accountKey
  const id =
    res?.locals?.mlCreds?.meli_conta_id ||
    res?.locals?.accountKey ||
    req?.cookies?.meli_conta_id ||
    null;

  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeMlb(v) {
  return String(v || "").trim().toUpperCase();
}

function sendErr(res, e) {
  const status = e?.statusCode || e?.status || 500;
  res.status(status).json({
    success: false,
    error: e?.message || "Erro interno",
    detail: e?.details || null,
  });
}

module.exports = {
  // GET /api/full/anuncios?page=1&pageSize=25&q=&status=all
  async list(req, res) {
    try {
      const meli_conta_id = pickAccountId(res, req);
      if (!meli_conta_id) {
        return res.status(401).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const page = req.query.page;
      const pageSize = req.query.pageSize;
      const q = (req.query.q || "").trim();
      const status = req.query.status || "all";

      const data = await FullService.list({
        meli_conta_id,
        page,
        pageSize,
        q,
        status,
      });

      return res.json({ success: true, ...data });
    } catch (e) {
      console.error("FullController.list error:", e);
      return sendErr(res, e);
    }
  },

  // POST /api/full/anuncios { mlb }
  // ✅ Opção A:
  // - adiciona o MLB na lista (banco) SEM validar FULL e SEM sync pesado
  // - o preenchimento/validação de inventory_id/estoque/status acontece no "Sincronizar"
  async add(req, res) {
    try {
      const meli_conta_id = pickAccountId(res, req);
      if (!meli_conta_id) {
        return res.status(401).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlb = normalizeMlb(req.body?.mlb);
      if (!mlb || !mlb.startsWith("MLB")) {
        return res
          .status(400)
          .json({ success: false, error: "MLB inválido." });
      }

      // 1) cria registro e garante duplicidade 409 (único por meli_conta_id + mlb)
      const row = await FullService.addManual({ meli_conta_id, mlb });

      // 2) NÃO valida FULL aqui. O usuário usa "Sincronizar" depois para preencher colunas.
      return res.status(201).json({ success: true, item: row });
    } catch (e) {
      console.error("FullController.add error:", e);
      return sendErr(res, e);
    }
  },

  // POST /api/full/anuncios/sync  { mlbs?: string[], mode?: string }
  async sync(req, res) {
    try {
      const meli_conta_id = pickAccountId(res, req);
      if (!meli_conta_id) {
        return res.status(401).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlbsRaw = req.body?.mlbs;
      const mlbs = Array.isArray(mlbsRaw)
        ? mlbsRaw.map(normalizeMlb).filter(Boolean)
        : null;

      const mode = req.body?.mode || "SYNC";

      const result = await FullService.sync({
        req,
        res,
        meli_conta_id,
        mlbs,
        mode,
      });

      return res.json({ success: true, ...result });
    } catch (e) {
      console.error("FullController.sync error:", e);
      return sendErr(res, e);
    }
  },

  // POST /api/full/anuncios/bulk-delete { mlbs: string[] }
  async bulkDelete(req, res) {
    try {
      const meli_conta_id = pickAccountId(res, req);
      if (!meli_conta_id) {
        return res.status(401).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlbs = (Array.isArray(req.body?.mlbs) ? req.body.mlbs : [])
        .map(normalizeMlb)
        .filter(Boolean);

      if (!mlbs.length) {
        return res
          .status(400)
          .json({ success: false, error: "Nenhum MLB informado." });
      }

      const out = await FullService.bulkDelete({ meli_conta_id, mlbs });
      return res.json({ success: true, ...out });
    } catch (e) {
      console.error("FullController.bulkDelete error:", e);
      return sendErr(res, e);
    }
  },

  // DELETE /api/full/anuncios/:mlb
  async removeOne(req, res) {
    try {
      const meli_conta_id = pickAccountId(res, req);
      if (!meli_conta_id) {
        return res.status(401).json({
          success: false,
          error: "Conta não selecionada (meli_conta_id ausente).",
        });
      }

      const mlb = normalizeMlb(req.params?.mlb);
      if (!mlb || !mlb.startsWith("MLB")) {
        return res
          .status(400)
          .json({ success: false, error: "MLB inválido." });
      }

      const out = await FullService.bulkDelete({ meli_conta_id, mlbs: [mlb] });
      return res.json({ success: true, ...out });
    } catch (e) {
      console.error("FullController.removeOne error:", e);
      return sendErr(res, e);
    }
  },
};
