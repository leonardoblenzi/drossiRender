// routes/htmlRoutes.js
"use strict";

const express = require("express");
const path = require("path");

// ✅ gate de permissão (padrao/admin/master)
const ensurePermission = require("../middleware/ensurePermission");

let HtmlController;
try {
  HtmlController = require("../controllers/HtmlController");
} catch (error) {
  console.error("❌ Erro ao carregar HtmlController:", error.message);
  throw error;
}

const router = express.Router();

// (Opcional) Evita cache das páginas HTML
function noCache(_req, res, next) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
}

/**
 * ✅ IMPORTANTE:
 * Rotas públicas (login/cadastro/selecao-plataforma) ficam no index.js.
 * Aqui deixamos apenas páginas do app (já protegidas pelo authGate).
 */

// Dashboard
router.get("/dashboard", noCache, HtmlController.servirDashboard);

// Páginas existentes
router.get("/remover-promocao", noCache, HtmlController.servirRemoverPromocao);
router.get("/criar-promocao", noCache, HtmlController.criarPromocao);

// ✅ Prazo (HTML)
router.get("/prazo", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "prazo.html"));
});

// ✅ Jardinagem (HTML) — ADMIN|MASTER (sensível) → redireciona p/ /nao-autorizado via middleware
router.get(
  "/jardinagem",
  noCache,
  ensurePermission.requireAdmin(),
  (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "views", "jardinagem.html"));
  }
);

// Utilitários de geração/diagnóstico
router.get("/criar-dashboard", noCache, HtmlController.criarDashboard);
router.get(
  "/criar-arquivo-remocao",
  noCache,
  HtmlController.criarArquivoRemocao
);
router.get("/debug/routes", HtmlController.debugRoutes);

// Teste simples
router.get("/test", (_req, res) => {
  res.send("Servidor Node.js com Express está rodando!");
});

// Produtos Estratégicos (HTML)
router.get("/estrategicos", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "estrategicos.html"));
});

// ✅ Exclusão de Anúncios (HTML) — ADMIN|MASTER (sensível)
router.get(
  "/excluir-anuncio",
  noCache,
  ensurePermission.requireAdmin(),
  (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "views", "excluir-anuncio.html"));
  }
);

// ✅ Editar Anúncio (HTML) — ADMIN|MASTER (sensível)
router.get(
  "/editar-anuncio",
  noCache,
  ensurePermission.requireAdmin(),
  (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "views", "editar-anuncio.html"));
  }
);

// Análise IA (HTML)
router.get("/analise-ia", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "analise-ia.html"));
});

// Filtro Avançado de Anúncios (HTML)
router.get("/filtro-anuncios", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "filtro-anuncios.html"));
});

// Full (HTML)
router.get("/full", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "full.html"));
});

// Curva ABC (HTML)
router.get("/ia-analytics/curva-abc", noCache, (_req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "views", "ia-analytics", "curva-abc.html")
  );
});

module.exports = router;
