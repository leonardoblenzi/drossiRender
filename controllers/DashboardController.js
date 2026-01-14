"use strict";

const dashboardService = require("../services/dashboardService");

// authMiddleware do seu projeto injeta req.ml.accessToken
function pickAccessToken(req) {
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

async function getMonthlySales(req, res) {
  try {
    const accessToken = pickAccessToken(req);
    const tz = String(req.query.tz || "America/Sao_Paulo");

    const data = await dashboardService.getMonthlySales({ accessToken, tz });

    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("DashboardController.getMonthlySales:", err);
    res
      .status(err.statusCode || 500)
      .json({ ok: false, error: err.message || "Erro inesperado" });
  }
}

module.exports = {
  getMonthlySales,
};
