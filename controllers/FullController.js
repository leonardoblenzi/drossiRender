// controllers/FullController.js (versão completa com CRUD)
'use strict';

const fetch = globalThis.fetch || require('node-fetch');
const FullService = require('../services/fullService');
const FullDB = require('../services/fullDatabaseService');

function toInt(v, def = 1) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

async function listProducts(req, res) {
  console.log('🚚 [FullController] listProducts - INICIANDO');
  console.log('🚚 [FullController] Query params:', req.query);

  try {
    const page      = toInt(req.query.page, 1);
    const pageSize  = toInt(req.query.page_size || req.query.pageSize, 25);
    const q         = String(req.query.q || '').trim();
    const status    = String(req.query.status || 'all');

    console.log('🚚 [FullController] Parâmetros processados:', { page, pageSize, q, status });

    const result = await FullService.listProducts({ page, pageSize, q, status });
    
    console.log(`🚚 [FullController] Resultado: ${result.items?.length || 0} produtos`);

    res.json(result);
  } catch (err) {
    console.error('❌ [FullController] listProducts error:', err);
    
    res.status(500).json({ 
      success: false, 
      error: 'internal_error', 
      message: err.message
    });
  }
}

async function getProductDetail(req, res) {
  console.log('🔍 [FullController] getProductDetail - MLB:', req.params.mlb);
  
  try {
    const mlb = String(req.params.mlb);
    const result = await FullService.getProductDetail(mlb);
    
    console.log('🚚 [FullController] getProductDetail resultado:', {
      mlb: result.mlb,
      title: result.title?.substring(0, 50) + '...' || 'sem título'
    });
    
    res.json(result);
  } catch (err) {
    console.error('❌ [FullController] getProductDetail error:', err);
    
    res.status(500).json({ 
      success: false, 
      error: 'internal_error', 
      message: err.message
    });
  }
}

// NOVO: Adicionar produto
async function addProduct(req, res) {
  console.log('➕ [FullController] addProduct - INICIANDO');
  console.log('➕ [FullController] Body:', req.body);

  try {
    const { mlb_id } = req.body;

    if (!mlb_id || typeof mlb_id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'invalid_mlb',
        message: 'MLB ID é obrigatório e deve ser uma string'
      });
    }

    // Validar formato MLB
    if (!mlb_id.match(/^MLB\d+$/)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_format',
        message: 'Formato de MLB inválido. Use: MLB1234567890'
      });
    }

    console.log(`➕ [FullController] Adicionando produto: ${mlb_id}`);

    // Verificar se já existe
    const existing = await FullDB.getProductByMLB(mlb_id);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'already_exists',
        message: 'Produto já existe no banco de dados'
      });
    }

    // Buscar credenciais ML
    const mlCreds = res.locals?.mlCreds || {};
    const token = req.access_token || mlCreds.access_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'no_token',
        message: 'Token de acesso não encontrado'
      });
    }

    // Buscar dados do produto no ML
    console.log(`➕ [FullController] Buscando dados do ML para: ${mlb_id}`);
    
    const itemResponse = await fetch(`https://api.mercadolibre.com/items/${mlb_id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!itemResponse.ok) {
      if (itemResponse.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'product_not_found',
          message: 'Produto não encontrado no Mercado Livre'
        });
      }
      throw new Error(`Erro ${itemResponse.status} ao buscar produto no ML`);
    }

    const item = await itemResponse.json();

    // Verificar se tem inventory_id (necessário para Full)
    if (!item.inventory_id) {
      return res.status(400).json({
        success: false,
        error: 'no_inventory_id',
        message: 'Produto não possui inventory_id (não pode estar no Full)'
      });
    }

    // Buscar estoque fulfillment
    console.log(`➕ [FullController] Verificando estoque Full para: ${mlb_id}`);
    
    let stockData = { available_quantity: 0, total: 0 };
    let hasFullfillment = false;

    try {
      const stockResponse = await fetch(`https://api.mercadolibre.com/inventories/${item.inventory_id}/stock/fulfillment`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (stockResponse.ok) {
        stockData = await stockResponse.json();
        hasFullfillment = true;
        console.log(`➕ [FullController] ✅ Produto tem fulfillment - Estoque: ${stockData.available_quantity}`);
      } else if (stockResponse.status === 404) {
        return res.status(400).json({
          success: false,
          error: 'not_in_full',
          message: 'Produto não está no Fulfillment'
        });
      } else {
        console.warn(`➕ [FullController] ⚠️ Erro ao verificar fulfillment: ${stockResponse.status}`);
      }
    } catch (stockError) {
      console.warn(`➕ [FullController] ⚠️ Erro ao buscar estoque:`, stockError.message);
    }

    // Preparar dados para salvar
    const productData = {
      mlb_id: item.id,
      image_url: item.pictures?.[0]?.url || item.thumbnail || '',
      available_quantity: Number(stockData.available_quantity || 0),
      sales_last_40_days: 0, // TODO: Buscar vendas reais
      total_sales_history: Number(item.sold_quantity || 0),
      is_full_stock: hasFullfillment,
      product_code: '', // TODO: Extrair do título ou SKU
      product_name: item.title || '',
      price_cents: Math.round(Number(item.price || 0) * 100),
      status: item.status || 'active',
      inventory_id: item.inventory_id || ''
    };

    // Salvar no banco
    const savedProduct = await FullDB.addProduct(productData);

    console.log(`➕ [FullController] ✅ Produto adicionado com sucesso: ${mlb_id}`);

    res.json({
      success: true,
      message: 'Produto adicionado com sucesso',
      product: savedProduct
    });

  } catch (err) {
    console.error('❌ [FullController] addProduct error:', err);
    
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
}

// NOVO: Remover produtos
async function removeProducts(req, res) {
  console.log('🗑️ [FullController] removeProducts - INICIANDO');
  console.log('🗑️ [FullController] Body:', req.body);

  try {
    const { mlb_ids } = req.body;

    if (!Array.isArray(mlb_ids) || mlb_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_mlb_ids',
        message: 'mlb_ids deve ser um array não vazio'
      });
    }

    console.log(`🗑️ [FullController] Removendo ${mlb_ids.length} produtos`);

    const results = {
      removed: [],
      not_found: [],
      errors: []
    };

    // Remover cada produto
    for (const mlb_id of mlb_ids) {
      try {
        const removed = await FullDB.removeProduct(mlb_id);
        
        if (removed) {
          results.removed.push(mlb_id);
          console.log(`🗑️ [FullController] ✅ Removido: ${mlb_id}`);
        } else {
          results.not_found.push(mlb_id);
          console.log(`🗑️ [FullController] ⚠️ Não encontrado: ${mlb_id}`);
        }
      } catch (error) {
        results.errors.push({ mlb_id, error: error.message });
        console.error(`🗑️ [FullController] ❌ Erro ao remover ${mlb_id}:`, error.message);
      }
    }

    const totalRemoved = results.removed.length;
    console.log(`🗑️ [FullController] ✅ Total removidos: ${totalRemoved} de ${mlb_ids.length}`);

    res.json({
      success: true,
      message: `${totalRemoved} produto(s) removido(s) com sucesso`,
      results
    });

  } catch (err) {
    console.error('❌ [FullController] removeProducts error:', err);
    
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
}

// NOVO: Sincronizar produto
async function syncProduct(req, res) {
  console.log('🔄 [FullController] syncProduct - INICIANDO');

  try {
    const { mlb } = req.params;

    // Buscar credenciais ML
    const mlCreds = res.locals?.mlCreds || {};
    const token = req.access_token || mlCreds.access_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'no_token',
        message: 'Token de acesso não encontrado'
      });
    }

    console.log(`🔄 [FullController] Sincronizando produto: ${mlb}`);

    const syncedProduct = await FullDB.syncProductWithML(mlb, token);

    if (!syncedProduct) {
      return res.status(404).json({
        success: false,
        error: 'product_not_found',
        message: 'Produto não encontrado no banco local'
      });
    }

    console.log(`🔄 [FullController] ✅ Produto sincronizado: ${mlb}`);

    res.json({
      success: true,
      message: 'Produto sincronizado com sucesso',
      product: syncedProduct
    });

  } catch (err) {
    console.error('❌ [FullController] syncProduct error:', err);
    
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
}

// NOVO: Estatísticas do banco
async function getStats(req, res) {
  console.log('📊 [FullController] getStats - INICIANDO');

  try {
    const stats = await FullDB.getStats();

    console.log('📊 [FullController] ✅ Estatísticas obtidas');

    res.json({
      success: true,
      stats
    });

  } catch (err) {
    console.error('❌ [FullController] getStats error:', err);
    
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
}

module.exports = { 
  listProducts, 
  getProductDetail, 
  addProduct, 
  removeProducts, 
  syncProduct, 
  getStats 
};