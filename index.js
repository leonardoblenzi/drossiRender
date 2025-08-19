// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
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
// PÁGINA DE SELEÇÃO DE CONTA (aberta) + Rotas de conta
// ==================================================
try {
  // Página de seleção (views/select-conta.html)
  app.get('/select-conta', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'select-conta.html'));
  });

  // Rotas de conta (listar/selecionar/limpar/atual)
  const accountModule = require('./routes/accountRoutes');
  app.use('/api/account', accountModule);

  // WhoAmI aberto (lendo direto do cookie)
  const ACCOUNTS = accountModule?.ACCOUNTS || null;
  app.get('/api/account/whoami', (req, res) => {
    const key = req.cookies?.ml_account || null;
    const label =
      key && ACCOUNTS
        ? (ACCOUNTS[key]?.label || ACCOUNTS[key]?.name || key)
        : null;
    res.json({
      ok: true,
      accountKey: key,
      accountLabel: label,
      hasCreds: !!(key && ACCOUNTS && ACCOUNTS[key])
    });
  });

  console.log('✅ Rotas de seleção de conta ativas');
} catch (error) {
  console.error('❌ Erro ao configurar seleção de conta:', error.message);
}

// ==========================================
// INICIALIZAR SISTEMA DE FILAS (NOVO)
// ==========================================
let queueService;
try {
  queueService = require('./services/queueService');
  console.log('✅ QueueService carregado');

  queueService
    .iniciarProcessamento()
    .then(() => console.log('🚀 Sistema de filas iniciado com sucesso'))
    .catch((error) =>
      console.error('❌ Erro ao iniciar sistema de filas:', error.message)
    );
} catch (error) {
  console.error('❌ Erro ao carregar QueueService:', error.message);
  console.warn('⚠️ Sistema de filas não disponível - processamento será apenas direto');
}

// ==========================================
// ROTAS DE MONITORAMENTO E DEBUG (ABERTAS)
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
        redis_connection: false
      }
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
      error: 'Erro ao verificar saúde do sistema',
      message: error.message
    });
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
      error: 'Erro ao obter estatísticas',
      message: error.message
    });
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
// GUARD: / → /select-conta se não houver conta
// (deve vir ANTES do ensureAccount)
// ==========================================
app.get('/', (req, res, next) => {
  if (!req.cookies?.ml_account) {
    return res.redirect('/select-conta');
  }
  return next();
});

// ==========================================
// PROTEÇÃO: EXIGIR CONTA SELECIONADA
// ==========================================
try {
  const ensureAccount = require('./middleware/ensureAccount');
  app.use(ensureAccount);
  console.log('✅ Middleware ensureAccount aplicado');
} catch (error) {
  console.error('❌ Erro ao aplicar ensureAccount:', error.message);
  console.warn('⚠️ Continuação sem exigir conta selecionada (temporário)');
}

// ==========================================
// ROTAS PROTEGIDAS (após ensureAccount)
// ==========================================

// Token
try {
  const tokenRoutes = require('./routes/tokenRoutes');
  app.use(tokenRoutes);
  console.log('✅ TokenRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar TokenRoutes:', error.message);
}

// Promoções
try {
  const promocaoRoutes = require('./routes/promocaoRoutes');
  app.use(promocaoRoutes);
  console.log('✅ PromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar PromocaoRoutes:', error.message);
}

// HTML (Dashboard e outras páginas)
try {
  const htmlRoutes = require('./routes/htmlRoutes');
  app.use(htmlRoutes);
  console.log('✅ HtmlRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar HtmlRoutes:', error.message);
  app.get('/', (req, res) => {
    res.send(`
      <h1>🛒 API Mercado Livre</h1>
      <p>Servidor funcionando, mas HtmlRoutes não carregou.</p>
      <p><strong>Erro:</strong> ${error.message}</p>
      <p><a href="/test-basic">🔧 Teste Básico</a></p>
    `);
  });
}

// Criar Promoção (API)
try {
  const criarPromocaoRoutes = require('./routes/criarPromocaoRoutes');
  app.use('/api/criar-promocao', criarPromocaoRoutes);
  console.log('✅ CriarPromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar CriarPromocaoRoutes:', error.message);
}

// Pesquisa em descrições
try {
  const pesquisaDescricaoRoutes = require('./routes/pesquisaDescricaoRoutes');
  app.use('/api/pesquisa-descricao', pesquisaDescricaoRoutes);
  console.log('✅ PesquisaDescricaoRoutes carregado (com sistema de filas)');
} catch (error) {
  console.error('❌ Erro ao carregar PesquisaDescricaoRoutes:', error.message);
}

// Interface HTML de Pesquisa
try {
  app.get('/pesquisa-descricao', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pesquisa-descricao.html'));
  });
  console.log('✅ Interface de pesquisa carregada (com monitoramento)');
} catch (error) {
  console.error('❌ Erro ao carregar interface de pesquisa:', error.message);
}

// Keyword Analytics (API + HTML)
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
// MIDDLEWARES FINAIS
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
        'GET / - Dashboard principal',
        'GET /pesquisa-descricao - Interface de pesquisa',
        'GET /keyword-analytics - Interface de analytics',
        'GET /criar-promocao - Interface de promoções',
        'GET /remover-promocao - Interface de remoção'
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
        'GET /api/keyword-analytics/* - APIs de keyword analytics'
      ],
      debug: [
        'GET /test-basic - Teste básico',
        'GET /debug/routes - Debug de rotas'
      ]
    }
  });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const server = app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log(`🌐 Servidor rodando em http://localhost:${PORT}`);
  console.log('🚀 ================================');
  console.log('📋 Interfaces Web:');
  console.log(`    • http://localhost:${PORT}/select-conta - Selecionar conta (novo)`);
  console.log(`    • http://localhost:${PORT}/ - Dashboard principal`);
  console.log(`    • http://localhost:${PORT}/pesquisa-descricao - Pesquisa em massa`);
  console.log(`    • http://localhost:${PORT}/keyword-analytics - Análise de palavras-chave`);
  console.log(`    • http://localhost:${PORT}/criar-promocao - Criar promoções`);
  console.log(`    • http://localhost:${PORT}/remover-promocao - Remover promoções`);
  console.log('🚀 ================================');
  console.log('📊 APIs Principais:');
  console.log(`    • http://localhost:${PORT}/api/account/* - Seleção de conta`);
  console.log(`    • http://localhost:${PORT}/api/pesquisa-descricao/ - Sistema de pesquisa`);
  console.log(`    • http://localhost:${PORT}/api/keyword-analytics/ - Analytics`);
  console.log(`    • http://localhost:${PORT}/api/promocao/ - Promoções`);
  console.log(`    • http://localhost:${PORT}/api/token/ - Gerenciamento de token`);
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
  console.log('💡 Tudo funcionando! Acesse o dashboard no navegador.');
  if (queueService) {
    console.log('🎯 Sistema de processamento em massa ATIVO');
    console.log('   • Processamento em background disponível');
    console.log('   • Monitoramento em tempo real ativo');
    console.log('   • Download de resultados habilitado');
  } else {
    console.log('⚠️ Sistema de filas INATIVO - apenas processamento direto');
  }
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
  setTimeout(() => {
    console.log('⏰ Forçando encerramento...');
    process.exit(1);
  }, 10000);
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
