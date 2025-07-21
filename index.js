require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares básicos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

console.log('🔍 Carregando módulos...');

// Carregar rotas com tratamento de erro individual
try {
  const tokenRoutes = require('./routes/tokenRoutes');
  app.use(tokenRoutes);
  console.log('✅ TokenRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar TokenRoutes:', error.message);
}

try {
  const promocaoRoutes = require('./routes/promocaoRoutes');
  app.use(promocaoRoutes);
  console.log('✅ PromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar PromocaoRoutes:', error.message);
}

try {
  const htmlRoutes = require('./routes/htmlRoutes');
  app.use(htmlRoutes);
  console.log('✅ HtmlRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar HtmlRoutes:', error.message);
}

try{
  const criarPromocaoRoutes = require('./routes/criarPromocaoRoutes');
  app.use('/api/criar-promocao', criarPromocaoRoutes);
  console.log('✅ CriarPromocaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar CriarPromocaoRoutes:', error.message); 

  // Fallback para rota principal
  app.get('/', (req, res) => {
    res.send(`
      <h1>🛒 API Mercado Livre</h1>
      <p>Servidor funcionando, mas HtmlRoutes não carregou.</p>
      <p><strong>Erro:</strong> ${error.message}</p>
      <p><a href="/test-basic">🔧 Teste Básico</a></p>
    `);
  });
}

// ✅ NOVA FUNCIONALIDADE: Pesquisa em Descrições
try {
  const pesquisaDescricaoRoutes = require('./routes/pesquisaDescricaoRoutes');
  app.use('/api/pesquisa-descricao', pesquisaDescricaoRoutes);
  console.log('✅ PesquisaDescricaoRoutes carregado');
} catch (error) {
  console.error('❌ Erro ao carregar PesquisaDescricaoRoutes:', error.message);
}

// ✅ ROTA PARA A INTERFACE HTML DE PESQUISA
try {
  app.get('/pesquisa-descricao', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/pesquisa-descricao.html'));
  });
  console.log('✅ Rota de interface de pesquisa carregada');
} catch (error) {
  console.error('❌ Erro ao carregar rota de interface de pesquisa:', error.message);
}

// Rota de teste sempre disponível
app.get('/test-basic', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor funcionando perfeitamente!',
    timestamp: new Date().toISOString(),
    env: {
      node_version: process.version,
      platform: process.platform,
      access_token_configured: !!process.env.ACCESS_TOKEN
    }
  });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('❌ Erro não tratado:', error);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
    message: error.message
  });
});

// CORRIGIDO: Middleware para rotas não encontradas (SEM usar '*')
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota não encontrada',
    path: req.originalUrl,
    method: req.method,
    available_routes: [
      'GET /',
      'GET /test-basic',
      'GET /test',
      'GET /remover-promocao',
      'GET /pesquisa-descricao',
      'GET /debug/routes'
    ]
  });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log(`�� Servidor rodando em http://localhost:${PORT}`);
  console.log('🚀 ================================');
  console.log('📋 Endpoints disponíveis:');
  console.log(`   • http://localhost:${PORT}/ - Dashboard principal`);
  console.log(`   • http://localhost:${PORT}/test-basic - Teste JSON`);
  console.log(`   • http://localhost:${PORT}/test - Teste HTML`);
  console.log(`   • http://localhost:${PORT}/remover-promocao - Interface de remoção`);
  console.log(`   • http://localhost:${PORT}/pesquisa-descricao - Pesquisa em descrições`);
  console.log(`   • http://localhost:${PORT}/debug/routes - Debug de rotas`);
  console.log('🚀 ================================');
  console.log('�� Configuração:');
  console.log(`   • Porta: ${PORT}`);
  console.log(`   • Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   • Token configurado: ${process.env.ACCESS_TOKEN ? '✅ SIM' : '❌ NÃO'}`);
  console.log('🚀 ================================');
  console.log('💡 Tudo funcionando! Acesse o dashboard no navegador.');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Recebido SIGTERM, encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Recebido SIGINT (Ctrl+C), encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});

module.exports = app;