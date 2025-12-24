// index.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Middlewares próprios
const ensureAccount = require("./middleware/ensureAccount"); // exige conta selecionada (ml_account)
const { authMiddleware } = require("./middleware/authMiddleware"); // garante token ML válido
const { ensureAuth } = require("./middleware/ensureAuth"); // ✅ JWT do app (auth_token)

const app = express();

app.set("trust proxy", 1);
app.set("etag", false);

const PORT = process.env.PORT || 3000;

// ========================
// Middlewares básicos
// ========================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// same-origin ok
app.use(cors());

app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

console.log("🔍 Carregando módulos...");

// ==================================================
// Injetar provider de token para rotas (Curva ABC usa isso)
// ==================================================
try {
  const { getAccessTokenForAccount } = require("./services/ml-auth");
  app.set("getAccessTokenForAccount", getAccessTokenForAccount);
  console.log(
    '✅ ML Token Adapter injetado em app.get("getAccessTokenForAccount")'
  );
} catch (err) {
  console.warn(
    "⚠️ Não foi possível injetar ml-auth. Rotas que dependem de tokens usarão fallbacks/env."
  );
}

// ==================================================
// (Opcional) Evita cache das páginas HTML
// ==================================================
function noCache(_req, res, next) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
}

// ==================================================
// ✅ Auth (JWT do APP) - rotas públicas
// ==================================================
try {
  if (!process.env.JWT_SECRET) {
    console.warn(
      "⚠️ JWT_SECRET não definido no .env / Render. Login JWT não vai funcionar corretamente."
    );
  }
  const authRoutes = require("./routes/authRoutes");
  app.use("/api/auth", authRoutes);
  console.log("✅ AuthRoutes carregado");
} catch (e) {
  console.error("❌ Erro ao carregar AuthRoutes:", e.message);
}

// ==========================================
// ✅ Páginas públicas (SEM LOGIN)
// 1) Seleção de plataforma
// 2) Login do app
// ==========================================
app.get("/", (req, res) => res.redirect("/selecao-plataforma"));

app.get("/selecao-plataforma", noCache, (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "selecao-plataforma.html"));
});

app.get("/login", noCache, (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/cadastro", noCache, (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "cadastro.html"));
});

// ✅ Página “Acesso não autorizado” (HTML de arquivo)
app.get("/nao-autorizado", noCache, (req, res) => {
  return res
    .status(403)
    .sendFile(path.join(__dirname, "views", "nao-autorizado.html"));
});

// Logout "completo" (limpa JWT + conta selecionada) — opcional
app.post("/api/ml/logout", noCache, (req, res) => {
  res.clearCookie("auth_token", { path: "/" });
  res.clearCookie("ml_account", { path: "/" }); // legacy
  res.clearCookie("meli_conta_id", { path: "/" }); // oauth
  return res.json({ ok: true });
});

// ==========================================
// INICIALIZAR SISTEMA DE FILAS
// ==========================================
let queueService;
try {
  queueService = require("./services/queueService");
  console.log("✅ QueueService carregado");
  queueService
    .iniciarProcessamento()
    .then(() => console.log("🚀 Sistema de filas iniciado com sucesso"))
    .catch((error) =>
      console.error("❌ Erro ao iniciar sistema de filas:", error.message)
    );
} catch (error) {
  console.error("❌ Erro ao carregar QueueService:", error.message);
  console.warn(
    "⚠️ Sistema de filas não disponível - processamento será apenas direto"
  );
}

// ==========================================
// Monitoramento/Debug (ABERTAS / SEM LOGIN)
// ==========================================
app.get("/api/system/health", (req, res) => {
  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || "development",
      features: {
        token_management: true,
        promocoes: true,
        pesquisa_descricao: true,
        keyword_analytics: true,
        queue_system: !!queueService,
        redis_connection: false,
      },
    };

    if (queueService) {
      queueService
        .verificarConexao()
        .then((redisOk) => {
          health.features.redis_connection = redisOk;
          res.json({ success: true, health });
        })
        .catch(() => {
          health.features.redis_connection = false;
          res.json({ success: true, health });
        });
    } else {
      res.json({ success: true, health });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Erro ao verificar saúde do sistema",
      message: error.message,
    });
  }
});

app.get("/api/system/stats", async (req, res) => {
  try {
    const stats = {
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
        platform: process.platform,
        node_version: process.version,
      },
      queue_system: null,
    };

    if (queueService) {
      try {
        stats.queue_system = await queueService.obterEstatisticas();
      } catch (error) {
        stats.queue_system = { error: error.message };
      }
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Erro ao obter estatísticas",
      message: error.message,
    });
  }
});

app.get("/test-basic", (req, res) => {
  res.json({
    success: true,
    message: "Servidor funcionando perfeitamente!",
    timestamp: new Date().toISOString(),
    env: {
      node_version: process.version,
      platform: process.platform,
      access_token_configured: !!process.env.MERCADOLIBRE_ACCESS_TOKEN,
      queue_system_available: !!queueService,
      redis_configured: !!(process.env.REDIS_URL || process.env.REDIS_HOST),
    },
  });
});

// ==========================================
// ✅ DAQUI PRA BAIXO: TUDO EXIGE LOGIN (JWT auth_token)
// ==========================================
app.use(ensureAuth);

// ==========================================
// ✅ OAuth Mercado Livre (vincular contas via autorização)
// (precisa estar após ensureAuth e antes do ensureAccount)
// ==========================================
try {
  const meliOAuthRoutes = require("./routes/meliOAuthRoutes");
  app.use("/api/meli", meliOAuthRoutes);
  console.log("✅ MeliOAuthRoutes carregado em /api/meli");
} catch (e) {
  console.error("❌ Erro ao carregar MeliOAuthRoutes:", e.message);
}

app.get("/vincular-conta", noCache, (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "vincular-conta.html"));
});

// Middleware: somente admin (usa req.user que o ensureAuth injeta)
function ensureAdminOnly(req, res, next) {
  const u = req.user || res.locals.user;
  if (u && String(u.nivel) === "administrador") return next();

  const accept = String(req.headers.accept || "");
  const wantsHtml = accept.includes("text/html");

  if (wantsHtml) return res.redirect("/nao-autorizado");
  return res.status(403).json({ ok: false, error: "Acesso não autorizado." });
}

// ✅ Admin: página de usuários (SOMENTE ADMIN)
app.get("/admin/usuarios", noCache, ensureAdminOnly, (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "admin-usuarios.html"));
});

// ✅ Admin APIs
try {
  const adminUsuariosRoutes = require("./routes/adminUsuariosRoutes");
  app.use("/api/admin", adminUsuariosRoutes);
  console.log("✅ AdminUsuariosRoutes carregado");
} catch (e) {
  console.error("❌ Erro ao carregar AdminUsuariosRoutes:", e.message);
}

// ==========================================
// Seleção de conta (AGORA já está protegida por ensureAuth)
// ==========================================
try {
  app.get("/select-conta", noCache, (req, res) => {
    res.sendFile(path.join(__dirname, "views", "select-conta.html"));
  });

  const accountRoutes = require("./routes/accountRoutes");
  app.use("/api/account", accountRoutes);

  console.log("✅ Rotas de seleção de conta ativas (protegidas por login JWT)");
} catch (error) {
  console.error("❌ Erro ao configurar seleção de conta:", error.message);
}

// ==========================================
// PROTEÇÃO: exigir conta selecionada (ml_account)
// (APÓS login JWT + seleção de conta)
// ==========================================
try {
  app.use(ensureAccount);
  console.log("✅ Middleware ensureAccount aplicado");
} catch (error) {
  console.error("❌ Erro ao aplicar ensureAccount:", error.message);
  console.warn("⚠️ Continuação sem exigir conta selecionada (temporário)");
}

// Debug helper (DEPOIS do ensureAccount)
app.get("/api/account/whoami", (req, res) => {
  res.json({
    ok: true,
    accountKey: res.locals.accountKey || null,
    accountLabel: res.locals.accountLabel || null,
    hasCreds: !!res.locals.mlCreds,
    user: req.user || null, // ✅ mostra usuário do JWT (nivel, email...)
  });
});

// ==========================================
// 🔒 GARANTIR TOKEN ML VÁLIDO PARA AS ROTAS ABAIXO
// ==========================================
app.use(authMiddleware);
console.log("✅ AuthMiddleware aplicado");

// ==========================================
// Rotas PROTEGIDAS do app
// ==========================================

// Análise de anúncios (usa ML)
const adAnalysisRoutes = require("./routes/adAnalysisRoutes");
app.use("/api/analise-anuncios", adAnalysisRoutes);

// Token
try {
  const tokenRoutes = require("./routes/tokenRoutes");
  app.use(tokenRoutes);
  console.log("✅ TokenRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar TokenRoutes:", error.message);
}

try {
  const validarDimensoesRoutes = require("./routes/validarDimensoesRoutes");
  app.use("/api/validar-dimensoes", validarDimensoesRoutes);
  console.log("✅ ValidarDimensoesRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar ValidarDimensoesRoutes:", error.message);
}

// ✅ Exclusão de anúncios (SOMENTE ADMIN) - aplique APENAS no prefixo do router
try {
  const excluirAnuncioRoutes = require("./routes/excluirAnuncioRoutes");

  // ✅ escolha um prefixo (recomendado)
  app.use("/api/excluir-anuncio", ensureAdminOnly, excluirAnuncioRoutes);

  console.log(
    "✅ ExcluirAnuncioRoutes carregado em /api/excluir-anuncio (ADMIN ONLY)"
  );
} catch (error) {
  console.error("❌ Erro ao carregar ExcluirAnuncioRoutes:", error.message);
}

// Promoção
try {
  const promocaoRoutes = require("./routes/removerPromocaoRoutes");
  app.use(promocaoRoutes);
  console.log("✅ PromocaoRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar PromocaoRoutes:", error.message);
}

// Criar Promoção (API de jobs)
try {
  const criarPromocaoRoutes = require("./routes/criarPromocaoRoutes");
  app.use("/api/criar-promocao", criarPromocaoRoutes);
  console.log("✅ CriarPromocaoRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar CriarPromocaoRoutes:", error.message);
}

// Rotas novas: Items e Promoções (cards)
try {
  const itemsRoutes = require("./routes/itemsRoutes");
  app.use(itemsRoutes);
  console.log("✅ ItemsRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar ItemsRoutes:", error.message);
}

try {
  const promocoesRoutes = require("./routes/promocoesRoutes");
  app.use(promocoesRoutes);
  console.log("✅ PromocoesRoutes carregado");
} catch (e) {
  console.error("❌ Erro ao carregar PromocoesRoutes:", e.message);
}

// HTML (dashboard e páginas)
try {
  const htmlRoutes = require("./routes/htmlRoutes");
  app.use(htmlRoutes);
  console.log("✅ HtmlRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar HtmlRoutes:", error.message);
}

// Pesquisa em Descrições (API)
try {
  const pesquisaDescricaoRoutes = require("./routes/pesquisaDescricaoRoutes");
  app.use("/api/pesquisa-descricao", pesquisaDescricaoRoutes);
  console.log("✅ PesquisaDescricaoRoutes carregado (com sistema de filas)");
} catch (error) {
  console.error("❌ Erro ao carregar PesquisaDescricaoRoutes:", error.message);
}

// Interfaces HTML auxiliares
try {
  app.get("/pesquisa-descricao", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "pesquisa-descricao.html"));
  });
  console.log("✅ Interface de pesquisa carregada (com monitoramento)");
} catch (error) {
  console.error("❌ Erro ao carregar interface de pesquisa:", error.message);
}

// Interface Validar Dimensões
try {
  app.get("/validar-dimensoes", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "validar-dimensoes.html"));
  });
  console.log("✅ Interface de validar dimensões carregada");
} catch (error) {
  console.error(
    "❌ Erro ao carregar interface de validar dimensões:",
    error.message
  );
}

// Keyword Analytics
try {
  const keywordAnalyticsRoutes = require("./routes/keywordAnalyticsRoutes");
  app.use("/api/keyword-analytics", keywordAnalyticsRoutes);
  console.log("✅ KeywordAnalyticsRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar KeywordAnalyticsRoutes:", error.message);
}

try {
  app.get("/keyword-analytics", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "keyword-analytics.html"));
  });
  console.log("✅ Interface de keyword analytics carregada");
} catch (error) {
  console.error(
    "❌ Erro ao carregar interface de keyword analytics:",
    error.message
  );
}

// Curva ABC — Rotas de API
try {
  const analyticsAbcRoutes = require("./routes/analytics-abc-Routes");
  app.use("/api/analytics", analyticsAbcRoutes);
  console.log("✅ Analytics ABC Routes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar Analytics ABC Routes:", error.message);
}

// Filtro Avançado de Anúncios (API)
try {
  const filtroAnunciosRoutes = require("./routes/analytics-filtro-anuncios-routes");
  app.use("/api/analytics", filtroAnunciosRoutes);
  console.log("✅ Filtro Anúncios Routes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar Filtro Anúncios Routes:", error.message);
}

// Produtos Estratégicos
try {
  const estrategicosRoutes = require("./routes/estrategicosRoutes");
  app.use(estrategicosRoutes);
  console.log("✅ EstrategicosRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar EstrategicosRoutes:", error.message);
}

// Full (API)
try {
  const fullRoutes = require("./routes/fullRoutes");
  app.use("/api/full", fullRoutes);
  console.log("✅ FullRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar FullRoutes:", error.message);
}

// Publicidade / Product Ads
try {
  const publicidadeRoutes = require("./routes/publicidadeRoutes");
  app.use("/api/publicidade", publicidadeRoutes);
  console.log("✅ PublicidadeRoutes carregado");
} catch (error) {
  console.error("❌ Erro ao carregar PublicidadeRoutes:", error.message);
}

try {
  app.get("/publicidade", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "publicidade.html"));
  });
  console.log("✅ Interface de publicidade (Product Ads) carregada");
} catch (error) {
  console.error("❌ Erro ao carregar interface de publicidade:", error.message);
}

// ==========================================
// ERRORS
// ==========================================
app.use((error, req, res, next) => {
  console.error("❌ Erro não tratado:", error);
  res.status(500).json({
    success: false,
    error: "Erro interno do servidor",
    message: error.message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Rota não encontrada",
    path: req.originalUrl,
    method: req.method,
  });
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 ================================");
  console.log(`🌐 Servidor rodando em http://localhost:${PORT}`);
  console.log("🚀 ================================");

  console.log("📋 Interfaces Web:");
  console.log(
    `    • http://localhost:${PORT}/selecao-plataforma - Seleção de plataforma`
  );
  console.log(`    • http://localhost:${PORT}/login - Login`);
  console.log(
    `    • http://localhost:${PORT}/select-conta - Selecionar conta (após login)`
  );
  console.log(`    • http://localhost:${PORT}/nao-autorizado - Acesso negado`);
  console.log("🚀 ================================");

  console.log("📊 APIs Auth:");
  console.log(
    `    • POST http://localhost:${PORT}/api/auth/login - Login (gera JWT cookie)`
  );
  console.log(
    `    • GET  http://localhost:${PORT}/api/auth/me - Quem sou eu (JWT)`
  );
  console.log(
    `    • POST http://localhost:${PORT}/api/auth/logout - Logout (limpa JWT)`
  );
  console.log(
    `    • POST http://localhost:${PORT}/api/ml/logout - Logout completo (JWT + conta)`
  );
  console.log("🚀 ================================");
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
async function gracefulShutdown(signal) {
  console.log(`🛑 Recebido ${signal}, encerrando servidor...`);
  if (queueService) {
    try {
      console.log("⏸️ Pausando sistema de filas...");
      await queueService.pausarJob();
      console.log("✅ Sistema de filas pausado");
    } catch (error) {
      console.error("❌ Erro ao pausar sistema de filas:", error.message);
    }
  }
  server.close(() => {
    console.log("✅ Servidor encerrado com sucesso");
    process.exit(0);
  });
  setTimeout(() => {
    console.log("⏰ Forçando encerramento...");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

module.exports = app;
