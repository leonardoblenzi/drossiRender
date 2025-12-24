// routes/htmlRoutes.js
const express = require("express");
const path = require("path");

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
 * Não tratamos "/" aqui — o index.js já decide entre
 * redirecionar para /select-conta ou seguir para o dashboard.
 * Se quiser um fallback local, descomente:
 *
 * router.get('/', (req, res) => res.redirect('/dashboard'));
 */

/* ================================
 * NOVO: Seleção de plataforma (primeira tela)
 * ================================ */
router.get("/selecao-plataforma", noCache, (_req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "views", "html", "selecao-plataforma.html")
  );
});

/* ================================
 * NOVO: Login Mercado Livre (tela do app)
 * ================================ */
router.get("/ml/login", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "login.html"));
});

/* ================================
 * NOVO: Cadastro (tela do app)
 * ================================ */
router.get("/cadastro", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "cadastro.html"));
});

// Dashboard
router.get("/dashboard", noCache, HtmlController.servirDashboard);

// Páginas existentes
router.get("/remover-promocao", noCache, HtmlController.servirRemoverPromocao);
router.get("/analise-anuncios", noCache, HtmlController.servirAnaliseAnuncios);
router.get("/criar-promocao", noCache, HtmlController.criarPromocao);

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

/* ================================
 * NOVO: Página Produtos Estratégicos (HTML)
 * ================================ */
router.get("/estrategicos", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "estrategicos.html"));
});

/* ================================
 * NOVO: Página Exclusão de Anúncios (HTML)
 * ================================ */
router.get("/excluir-anuncio", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "excluir-anuncio.html"));
});

/* ================================
 * NOVO: Página Filtro Avançado de Anúncios (HTML)
 * ================================ */
router.get("/filtro-anuncios", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "filtro-anuncios.html"));
});

/* ================================
 * Página Full (HTML)
 * ================================ */
router.get("/full", noCache, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "full.html"));
});

/* ================================
 * Já existente: Página Curva ABC (HTML)
 * ================================ */
router.get("/ia-analytics/curva-abc", noCache, (_req, res) => {
  res.sendFile(
    path.join(__dirname, "..", "views", "ia-analytics", "curva-abc.html")
  );
});

module.exports = router;
