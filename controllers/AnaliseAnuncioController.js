// controllers/AnaliseAnuncioController.js
"use strict";

const analiseAnuncioService = require("../services/analiseAnuncioService");

function pickAccessToken(req) {
  // authMiddleware do seu projeto injeta req.ml.accessToken
  const t = req?.ml?.accessToken;
  if (!t) {
    const err = new Error(
      "Token ML ausente em req.ml.accessToken (authMiddleware não injetou)."
    );
    err.statusCode = 401;
    throw err;
  }
  return t;
}

function normMlb(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (!/^MLB\d+$/.test(s)) return null;
  return s;
}

module.exports = {
  async overview(req, res) {
    try {
      const mlb = normMlb(req.params.mlb);
      if (!mlb) {
        return res.status(400).json({
          ok: false,
          error: "MLB inválido. Ex: MLB123...",
        });
      }

      const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));
      const zip_code = String(req.query.zip_code || "").trim();

      const accessToken = pickAccessToken(req);

      const data = await analiseAnuncioService.getOverview({
        mlb,
        accessToken,
        days,
        zip_code: zip_code || null,
      });

      // Front não depende de "ok", mas é útil padronizar
      return res.json({ ok: true, ...data });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        ok: false,
        error: "Erro ao carregar overview do anúncio",
        message: error.message,
      });
    }
  },
};
