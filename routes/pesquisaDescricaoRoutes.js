const express = require('express');
const router = express.Router();
const PesquisaDescricaoController = require('../controllers/pesquisaDescricaoController');

// Middleware de log para debug
router.use((req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📋 Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Rota principal: Pesquisar texto em descrições
router.post('/pesquisar', async (req, res) => {
  try {
    await PesquisaDescricaoController.pesquisarTexto(req, res);
  } catch (error) {
    console.error('❌ Erro na rota de pesquisa:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno na rota de pesquisa',
      error: error.message
    });
  }
});

// Rota: Consultar status de processamento em lote
router.get('/status/:processId', async (req, res) => {
  try {
    await PesquisaDescricaoController.consultarStatus(req, res);
  } catch (error) {
    console.error('❌ Erro na rota de status:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno na consulta de status',
      error: error.message
    });
  }
});

// Rota: Listar todos os processamentos
router.get('/processamentos', async (req, res) => {
  try {
    await PesquisaDescricaoController.listarProcessamentos(req, res);
  } catch (error) {
    console.error('❌ Erro na rota de listagem:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno na listagem de processamentos',
      error: error.message
    });
  }
});

// Rota: Teste de conectividade
router.get('/teste', (req, res) => {
  res.json({
    success: true,
    message: 'API de Pesquisa em Descrições funcionando!',
    timestamp: new Date().toISOString(),
    endpoints_disponiveis: [
      'POST /api/pesquisa-descricao/pesquisar',
      'GET /api/pesquisa-descricao/status/:processId',
      'GET /api/pesquisa-descricao/processamentos',
      'GET /api/pesquisa-descricao/teste'
    ],
    exemplo_uso: {
      url: '/api/pesquisa-descricao/pesquisar',
      method: 'POST',
      body: {
        mlb_ids: ['MLB1234567890', 'MLB0987654321'],
        texto_pesquisa: 'madeira eucalipto',
        processar_em_lote: false,
        analise_detalhada: true
      }
    }
  });
});

// Middleware de tratamento de erros específico para esta rota
router.use((error, req, res, next) => {
  console.error('❌ Erro não tratado nas rotas de pesquisa:', error);
  res.status(500).json({
    success: false,
    message: 'Erro interno nas rotas de pesquisa de descrição',
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

module.exports = router;