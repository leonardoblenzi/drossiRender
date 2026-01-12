"use strict";

const express = require("express");
const AnaliseAnuncioController = require("../controllers/AnaliseAnuncioController");

// ✅ opcional: se quiser proteger debug route por permissão
let ensurePermission = null;
try {
  ensurePermission = require("../middleware/ensurePermission");
} catch (_) {
  // se não existir, seguimos sem (não quebra)
}

const router = express.Router();

// ✅ aplica no-store em tudo deste módulo
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/**
 * IMPORTANTE:
 * Este router deve ser montado no index.js assim:
 *   app.use("/api/analise-anuncios", require("./routes/AnaliseAnuncioRoutes"));
 *
 * Observação:
 * No seu index.js, estas rotas já estão protegidas por:
 *   ensureAuth -> ensureAccount -> app.use(authMiddleware)
 * Portanto NÃO aplique authMiddleware aqui dentro.
 */

// Overview “tipo Mercado Livre” (vendidos/estoque/visitas/criado/premium/catálogo/frete + vendedor)
router.get("/overview/:mlb", AnaliseAnuncioController.overview);

// ✅ NOVO: Insights via IA (Gemini)
router.post("/insights/:mlb", AnaliseAnuncioController.insights);

// Health check do módulo
router.get("/ping", (_req, res) => {
  res.json({ ok: true, feature: "analise-anuncios" });
});

// Debug opcional (recomendo proteger ou desligar em produção)
const debugHandler = (_req, res) => {
  const routes = router.stack
    .filter((l) => l.route)
    .map((l) => {
      const methods = Object.keys(l.route.methods || {})
        .filter(Boolean)
        .map((m) => m.toUpperCase());
      return {
        methods: methods.length ? methods : ["GET"],
        path: l.route.path,
      };
    });

  res.json({ ok: true, routes });
};

// ✅ Se tiver ensurePermission, protege (MASTER). Senão, só expõe fora de production.
if (ensurePermission?.requireMaster) {
  router.get("/routes", ensurePermission.requireMaster(), debugHandler);
} else {
  router.get("/routes", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ ok: false, error: "Rota não encontrada" });
    }
    return debugHandler(req, res);
  });
}

module.exports = router;
