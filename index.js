require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Middlewares próprios
const ensureAccount = require('./middleware/ensureAccount');         // exige conta selecionada
const { authMiddleware } = require('./middleware/authMiddleware');   // ✅ garante token válido

const app = express();

app.set('trust proxy', 1);
app.set('etag', false);

const PORT = process.env.PORT || 3000;

// ========================
// Middlewares básicos
// ========================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

console.log('🔍 Carregando módulos...');

// ==================================================
// Injetar provider de token para rotas (Curva ABC usa isso)
// ==================================================
try {
  const { getAccessTokenForAccount } = require('./services/ml-auth');
  app.set('getAccessTokenForAccount', getAccessTokenForAccount);
  console.log('✅ ML Token Adapter injetado em app.get("getAccessTokenForAccount")');
} catch (err) {
  console.warn('⚠️ Não foi possível injetar ml-auth. Rotas que dependem de tokens usarão fallbacks/env.');
}

// ==================================================
// Seleção de conta (rotas ABERTAS)
// ==================================================
try {
  // Página de seleção (NÃO protegida)
  app.get('/select-conta', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'select-conta.html'));
  });

  // API de conta (NÃO protegida)
  const accountRoutes = require('./routes/accountRoutes');
  app.use('/api/account', accountRoutes);

  console.log('✅ Rotas de seleção de conta ativas');
} catch (error) {
  console.error('❌ Erro ao configurar seleção de conta:', error.message);
}

// ==========================================
// INICIALIZAR SISTEMA DE FILAS
// ==========================================
let queueService;
try {
  queueService = require('./services/queueService');
  console.log('✅ QueueService carregado');
  queueService.iniciarProcessamento()
    .then(() => console.log('🚀 Sistema de filas iniciado com sucesso'))
    .catch((error) => console.error('❌ Erro ao iniciar sistema de filas:', error.message));
} catch (error) {
  console.error('❌ Erro ao carregar QueueService:', error.message);
  console.warn('⚠️ Sistema de filas não disponível - processamento será apenas direto');
}

// ==========================================
// Monitoramento/Debug (ABERTAS)
// ==========================================
app.get('/api/system/health', (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      features: {
        token_management: true,
        promocoes: true,
        pesquisa_descricao: true,
        keyword_analytics: true,
        queue_system: !!queueService,
        redis_connection: false,
      }
    };

    if (queueService) {
      queueService.verificarConexao()
        .then((redisOk) => { health.features.redis_connection = redisOk; res.json({ success: true, health }); })
        .catch(() => { health.features.redis_connection = false; res.json({ success: true, health }); });
    } else {
      res.json({ success: true, health });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao verificar saúde do sistema', message: error.message });
  }
});

app.get('/api/system/stats', async (req, res) => {
  try {
    const stats = {
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
        platform: process.platform,
        node_version: process.version
      },
      queue_system: null
    };

    if (queueService) {
      try { stats.queue_system = await queueService.obterEstatisticas(); }
      catch (error) { stats.queue_system = { error: error.message }; }
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao obter estatísticas', message: error.message });
  }
});

app.get('/test-basic', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor funcionando perfeitamente!',
    timestamp: new Date().toISOString(),
    env: {
      node_version: process.version,
      platform: process.platform,
      access_token_configured: !!process.env.MERCADOLIBRE_ACCESS_TOKEN,
      queue_system_available: !!queueService,
      redis_configured: !!(process.env.REDIS_URL || process.env.REDIS_HOST)
    },
    features: [
      'Token Management',
      'Promoções',
      'Pesquisa em Descrições',
      'Keyword Analytics',
      queueService ? 'Sistema de Filas' : 'Sistema de Filas (Indisponível)',
      'Monitoramento em Tempo Real'
    ]
  });
});

// ==========================================
// ROOT: SEMPRE levar à seleção ou dashboard
// ==========================================
// Por padrão, força ir para /select-conta ao abrir o app.
// Se quiser permitir pular quando já houver cookie, mude FORCE_ACCOUNT_SELECTION=false no .env
const FORCE_ACCOUNT_SELECTION = String(process.env.FORCE_ACCOUNT_SELECTION || 'true').toLowerCase() === 'true';

app.get('/', (req, res) => {
  const hasAccountCookie = !!req.cookies?.ml_account;
  if (FORCE_ACCOUNT_SELECTION || !hasAccountCookie) {
    return res.redirect('/select-conta');
  }
  // Se não for forçado e já existe conta, mande ao dashboard:
  return res.redirect('/dashboard');
});

// ==========================================
// PROTEÇÃO: exigir conta selecionada (APÓS root redirect)
// ==========================================
try {
  app.use(ensureAccount); // ✅ aplicado uma ÚNICA vez
  console.log('✅ Middleware ensureAccount aplicado');
} catch (error) {
  console.error('❌ Erro ao aplicar ensureAccount:', error.message);
  console.warn('⚠️ Continuação sem exigir conta selecionada (temporário)');
}

// Debug helper (DEPOIS do ensureAccount)
app.get('/api/account/whoami', (req, res) => {
  res.json({
    ok: true,
    accountKey: res.locals.accountKey || null,
    accountLabel: res.locals.accountLabel || null,
    hasCreds: !!res.locals.mlCreds,
  });
});

// ==========================================
// 🔒 GARANTIR TOKEN VÁLIDO PARA AS ROTAS ABAIXO
// ==========================================
app.use(authMiddleware); // ✅ injeta req.access_token e atualiza res.locals.mlCreds.access_token
console.log('✅ AuthMiddleware aplicado');

// ==========================================
// Rotas PROTEGIDAS do app
// ==========================================

// Análise de anúncios (usa ML) — agora após authMiddleware
const adAnalysisRoutes = require('./routes/adAnalysisRoutes');
app.use('/api/analise-anuncios', adAnalysisRoutes);

// Token
try {
  const tokenRoutes = require('./routes/tokenRoutes');
  app.use(tokenRoutes);
  console.log('✅ TokenRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar TokenRoutes:', error.message);
}

// Promoção (API já existente no seu projeto)
try {
  const promocaoRoutes = require('./routes/removerPromocaoRoutes');
  app.use(promocaoRoutes);
  console.log('✅ PromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar PromocaoRoutes:', error.message);
}

// Criar Promoção (API de jobs)
try {
  const criarPromocaoRoutes = require('./routes/criarPromocaoRoutes');
  app.use('/api/criar-promocao', criarPromocaoRoutes);
  console.log('✅ CriarPromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar CriarPromocaoRoutes:', error.message);
}

// Rotas novas: Items e Promoções (cards)
try {
  const itemsRoutes = require('./routes/itemsRoutes');
  app.use(itemsRoutes);
  console.log('✅ ItemsRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar ItemsRoutes:', error.message);
}

try {
  const promocoesRoutes = require('./routes/promocoesRoutes');
  app.use(promocoesRoutes);
  console.log('✅ PromocoesRoutes carregado');
} catch (e) {
  console.error('❌ Erro ao carregar PromocoesRoutes:', e.message);
}

// HTML (dashboard e páginas)
try {
  const htmlRoutes = require('./routes/htmlRoutes');
  app.use(htmlRoutes);
  console.log('✅ HtmlRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar HtmlRoutes:', error.message);
}

// Pesquisa em Descrições (API)
try {
  const pesquisaDescricaoRoutes = require('./routes/pesquisaDescricaoRoutes');
  app.use('/api/pesquisa-descricao', pesquisaDescricaoRoutes);
  console.log('✅ PesquisaDescricaoRoutes carregado (com sistema de filas)');
} catch (error) {
  console.error('❌ Erro ao carregar PesquisaDescricaoRoutes:', error.message);
}

// Interfaces HTML auxiliares
try {
  app.get('/pesquisa-descricao', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pesquisa-descricao.html'));
  });
  console.log('✅ Interface de pesquisa carregada (com monitoramento)');
} catch (error) {
  console.error('❌ Erro ao carregar interface de pesquisa:', error.message);
}

// Keyword Analytics
try {
  const keywordAnalyticsRoutes = require('./routes/keywordAnalyticsRoutes');
  app.use('/api/keyword-analytics', keywordAnalyticsRoutes);
  console.log('✅ KeywordAnalyticsRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar KeywordAnalyticsRoutes:', error.message);
}

try {
  app.get('/keyword-analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'keyword-analytics.html'));
  });
  console.log('✅ Interface de keyword analytics carregada');
} catch (error) {
  console.error('❌ Erro ao carregar interface de keyword analytics:', error.message);
}

// ==========================================
// 🔹 Curva ABC — Rotas de API + Página HTML
// ==========================================
try {
  const analyticsAbcRoutes = require('./routes/analytics-abc-Routes'); // API
  app.use('/api/analytics', analyticsAbcRoutes);
  console.log('✅ Analytics ABC Routes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar Analytics ABC Routes:', error.message);
}

try {
  // Página HTML (mantém seu padrão de views/arquivo .html)
  app.get('/ia-analytics/curva-abc', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'ia-analytics', 'curva-abc.html'));
  });
  console.log('✅ Página Curva ABC carregada');
} catch (error) {
  console.error('❌ Erro ao expor página Curva ABC:', error.message);
}

// Full (API)
try {
  const fullRoutes = require('./routes/fullRoutes');
  app.use('/api/full', fullRoutes);
  console.log('✅ FullRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar FullRoutes:', error.message);
}

// ==========================================
// ERRORS
// ==========================================
app.use((error, req, res, next) => {
  console.error('❌ Erro não tratado:', error);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
    message: error.message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota não encontrada',
    path: req.originalUrl,
    method: req.method,
    available_routes: {
      interfaces: [
        'GET /select-conta - Selecionar conta',
        'GET /dashboard - Dashboard principal',
        'GET /pesquisa-descricao - Interface de pesquisa',
        'GET /keyword-analytics - Interface de analytics',
        'GET /criar-promocao - Interface de promoções',
        'GET /remover-promocao - Interface de remoção',
        'GET /ia-analytics/curva-abc - Curva ABC (tempo real)'
      ],
      apis: [
        'GET /api/account/list - Listar contas',
        'GET /api/account/current - Conta atual',
        'POST /api/account/select - Selecionar conta',
        'POST /api/account/clear - Limpar seleção',
        'GET /api/system/health - Health check',
        'GET /api/system/stats - Estatísticas do sistema',
        'POST /api/pesquisa-descricao/pesquisar - Pesquisa rápida',
        'POST /api/pesquisa-descricao/processar-massa - Processamento em massa',
        'GET /api/pesquisa-descricao/jobs - Listar jobs',
        'GET /api/pesquisa-descricao/status/:job_id - Status de job',
        'GET /api/keyword-analytics/* - APIs de keyword analytics',
        'GET /api/analytics/abc-ml/summary - Curva ABC resumo (ML tempo real)',
        'GET /api/analytics/abc-ml/items - Curva ABC itens (ML tempo real)'
      ],
      debug: [
        'GET /test-basic - Teste básico',
        'GET /debug/routes - Debug de rotas'
      ]
    }
  });
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 ================================');
  console.log(`🌐 Servidor rodando em http://localhost:${PORT}`);
  console.log('🚀 ================================');
  console.log('📋 Interfaces Web:');
  console.log(`    • http://localhost:${PORT}/select-conta - Selecionar conta (obrigatório ao abrir)`);
  console.log(`    • http://localhost:${PORT}/dashboard - Dashboard principal`);
  console.log(`    • http://localhost:${PORT}/pesquisa-descricao - Pesquisa em massa`);
  console.log(`    • http://localhost:${PORT}/keyword-analytics - Análise de palavras-chave`);
  console.log(`    • http://localhost:${PORT}/criar-promocao - Criar promoções`);
  console.log(`    • http://localhost:${PORT}/remover-promocao - Remover promoções`);
  console.log(`    • http://localhost:${PORT}/ia-analytics/curva-abc - Curva ABC (Analytics)`);
  console.log('🚀 ================================');
  console.log('📊 APIs Principais:');
  console.log(`    • http://localhost:${PORT}/api/account/* - Seleção de conta`);
  console.log(`    • http://localhost:${PORT}/api/pesquisa-descricao/ - Sistema de pesquisa`);
  console.log(`    • http://localhost:${PORT}/api/keyword-analytics/ - Analytics`);
  console.log(`    • http://localhost:${PORT}/api/promocao/ - Promoções`);
  console.log(`    • http://localhost:${PORT}/api/token/ - Gerenciamento de token`);
  console.log(`    • http://localhost:${PORT}/api/analytics/abc-ml/* - Curva ABC (ML tempo real)`);
  console.log('🚀 ================================');
  console.log('🔧 Sistema de Monitoramento:');
  console.log(`    • http://localhost:${PORT}/api/system/health - Health check`);
  console.log(`    • http://localhost:${PORT}/api/system/stats - Estatísticas`);
  console.log(`    • http://localhost:${PORT}/test-basic - Teste básico`);
  console.log('🚀 ================================');
  console.log('⚙️ Configuração:');
  console.log(`    • Porta: ${PORT}`);
  console.log(`    • Ambiente: ${process.env.NODE_ENV || 'development'}`);
  const acc = (process.env.SELECTED_ACCOUNT || process.env.DEFAULT_ACCOUNT || '').toLowerCase();
  if (acc) {
    const U = acc.toUpperCase();
    const hasToken = !!process.env[`ML_${U}_ACCESS_TOKEN`];
    console.log(`    • Conta default: ${acc} (${hasToken ? '✅ token presente' : '⚠️ sem token em .env'})`);
  } else {
    console.log('    • Conta default: (nenhuma)');
  }
  console.log(`    • Sistema de Filas: ${queueService ? '✅ Ativo' : '❌ Indisponível'}`);
  console.log(`    • Redis: ${process.env.REDIS_URL || process.env.REDIS_HOST ? '✅ Configurado' : '❌ Não configurado'}`);
  console.log('🚀 ================================');
});


// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
async function gracefulShutdown(signal) {
  console.log(`🛑 Recebido ${signal}, encerrando servidor...`);
  if (queueService) {
    try {
      console.log('⏸️ Pausando sistema de filas...');
      await queueService.pausarJob();
      console.log('✅ Sistema de filas pausado');
    } catch (error) {
      console.error('❌ Erro ao pausar sistema de filas:', error.message);
    }
  }
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
  setTimeout(() => { console.log('⏰ Forçando encerramento...'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

module.exports = app;
