// services/fullService.js (usando banco JSON)
'use strict';

const FullDB = require('./fullDatabaseService');

const LOG_PREFIX = '[FullService]';

/**
 * Lista produtos do banco JSON local
 */
async function listProducts({ page = 1, pageSize = 25, q = '', status = 'all', accountCtx = {} } = {}) {
  console.log(`${LOG_PREFIX} 📚 Buscando produtos no banco local`);
  
  try {
    const result = await FullDB.searchProducts({ q, status, page, pageSize });
    
    console.log(`${LOG_PREFIX} ✅ Encontrados ${result.items.length} de ${result.total} produtos`);
    
    // Converter para formato esperado pela interface
    const items = result.items.map(product => ({
      mlb: product.mlb_id,
      title: product.product_name || '',
      price_cents: product.price_cents || 0,
      stock_full: product.available_quantity || 0,
      promo_active: false, // TODO: Implementar lógica de promoção
      promo_percent: null,
      status: product.status || 'active',
      image: product.image_url || ''
    }));
    
    return {
      items,
      total: result.total,
      page: result.page,
      page_size: result.page_size
    };
    
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Erro ao listar produtos:`, error);
    return { items: [], total: 0, page, page_size: pageSize };
  }
}

/**
 * Detalhe de produto específico
 */
async function getProductDetail(mlb, { accountCtx = {} } = {}) {
  console.log(`${LOG_PREFIX} 🔍 Buscando detalhes do produto ${mlb}`);
  
  try {
    const product = await FullDB.getProductByMLB(mlb);
    
    if (!product) {
      throw new Error('Produto não encontrado no banco local');
    }
    
    // TODO: Buscar vendas dos últimos 40 dias
    const sales_40d = { total: product.sales_last_40_days || 0, series: [] };
    
    // TODO: Processar SKUs/variações
    const skus = [];
    
    return {
      mlb: product.mlb_id,
      title: product.product_name || '',
      image: product.image_url || '',
      price_cents: product.price_cents || 0,
      stock_full_total: product.available_quantity || 0,
      promo_active: false,
      promo_percent: null,
      status: product.status || 'active',
      sales_40d,
      skus,
      inventory_id: product.inventory_id,
      product_code: product.product_code,
      total_sales_history: product.total_sales_history || 0
    };
    
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Erro ao buscar detalhes:`, error);
    throw error;
  }
}

module.exports = { listProducts, getProductDetail };