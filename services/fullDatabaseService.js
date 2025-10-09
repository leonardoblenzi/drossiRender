// services/fullDatabaseService.js
'use strict';

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'full_stock.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'full_operations.log');

const LOG_PREFIX = '[FullDB]';

// Garantir que os diretórios existem
async function ensureDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.mkdir(path.join(DATA_DIR, 'logs'), { recursive: true });
  } catch (error) {
    console.error(`${LOG_PREFIX} Erro ao criar diretórios:`, error.message);
  }
}

// Estrutura inicial do banco
function getInitialDatabase() {
  return {
    metadata: {
      last_updated: new Date().toISOString(),
      total_products: 0,
      version: "1.0.0"
    },
    products: []
  };
}

// Ler banco de dados
async function readDatabase() {
  try {
    await ensureDirectories();
    
    const data = await fs.readFile(DB_FILE, 'utf8');
    const db = JSON.parse(data);
    
    console.log(`${LOG_PREFIX} ✅ Banco carregado: ${db.products?.length || 0} produtos`);
    return db;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`${LOG_PREFIX} 🆕 Criando novo banco de dados`);
      const initialDb = getInitialDatabase();
      await writeDatabase(initialDb);
      return initialDb;
    }
    throw error;
  }
}

// Escrever banco de dados
async function writeDatabase(data) {
  try {
    await ensureDirectories();
    
    // Atualizar metadata
    data.metadata.last_updated = new Date().toISOString();
    data.metadata.total_products = data.products?.length || 0;
    
    // Criar backup antes de escrever
    await createBackup();
    
    // Escrever arquivo
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    
    console.log(`${LOG_PREFIX} ✅ Banco salvo: ${data.products?.length || 0} produtos`);
    
    // Log da operação
    await logOperation('WRITE', `Banco atualizado com ${data.products?.length || 0} produtos`);
    
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Erro ao salvar banco:`, error.message);
    throw error;
  }
}

// Criar backup
async function createBackup() {
  try {
    const exists = await fs.access(DB_FILE).then(() => true).catch(() => false);
    if (!exists) return;
    
    const timestamp = new Date().toISOString().split('T')[0];
    const backupFile = path.join(BACKUP_DIR, `full_stock_${timestamp}.json`);
    
    // Verificar se já existe backup de hoje
    const backupExists = await fs.access(backupFile).then(() => true).catch(() => false);
    if (backupExists) return;
    
    await fs.copyFile(DB_FILE, backupFile);
    console.log(`${LOG_PREFIX} 💾 Backup criado: ${path.basename(backupFile)}`);
    
    // Limpar backups antigos (manter apenas 7 dias)
    await cleanOldBackups();
    
  } catch (error) {
    console.warn(`${LOG_PREFIX} ⚠️ Erro ao criar backup:`, error.message);
  }
}

// Limpar backups antigos
async function cleanOldBackups() {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    for (const file of files) {
      if (file.startsWith('full_stock_') && file.endsWith('.json')) {
        const dateStr = file.replace('full_stock_', '').replace('.json', '');
        const fileDate = new Date(dateStr);
        
        if (fileDate < sevenDaysAgo) {
          await fs.unlink(path.join(BACKUP_DIR, file));
          console.log(`${LOG_PREFIX} 🗑️ Backup antigo removido: ${file}`);
        }
      }
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ⚠️ Erro ao limpar backups:`, error.message);
  }
}

// Log de operações
async function logOperation(operation, message) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [${operation}] ${message}\n`;
    await fs.appendFile(LOG_FILE, logEntry, 'utf8');
  } catch (error) {
    console.warn(`${LOG_PREFIX} ⚠️ Erro ao fazer log:`, error.message);
  }
}

// Listar todos os produtos
async function getAllProducts() {
  const db = await readDatabase();
  return db.products || [];
}

// Buscar produto por MLB
async function getProductByMLB(mlbId) {
  const db = await readDatabase();
  return db.products.find(p => p.mlb_id === mlbId) || null;
}

// Adicionar produto
async function addProduct(productData) {
  const db = await readDatabase();
  
  // Verificar se já existe
  const existingIndex = db.products.findIndex(p => p.mlb_id === productData.mlb_id);
  
  if (existingIndex >= 0) {
    // Atualizar existente
    db.products[existingIndex] = {
      ...db.products[existingIndex],
      ...productData,
      last_sync: new Date().toISOString()
    };
    await logOperation('UPDATE', `Produto ${productData.mlb_id} atualizado`);
  } else {
    // Adicionar novo
    const newProduct = {
      ...productData,
      added_date: new Date().toISOString(),
      last_sync: new Date().toISOString()
    };
    db.products.push(newProduct);
    await logOperation('ADD', `Produto ${productData.mlb_id} adicionado`);
  }
  
  await writeDatabase(db);
  return db.products.find(p => p.mlb_id === productData.mlb_id);
}

// Remover produto
async function removeProduct(mlbId) {
  const db = await readDatabase();
  const initialLength = db.products.length;
  
  db.products = db.products.filter(p => p.mlb_id !== mlbId);
  
  if (db.products.length < initialLength) {
    await writeDatabase(db);
    await logOperation('REMOVE', `Produto ${mlbId} removido`);
    return true;
  }
  
  return false;
}

// Atualizar produto
async function updateProduct(mlbId, updates) {
  const db = await readDatabase();
  const productIndex = db.products.findIndex(p => p.mlb_id === mlbId);
  
  if (productIndex >= 0) {
    db.products[productIndex] = {
      ...db.products[productIndex],
      ...updates,
      last_sync: new Date().toISOString()
    };
    
    await writeDatabase(db);
    await logOperation('UPDATE', `Produto ${mlbId} atualizado`);
    return db.products[productIndex];
  }
  
  return null;
}

// Buscar produtos com filtros
async function searchProducts({ q = '', status = 'all', page = 1, pageSize = 25 } = {}) {
  const db = await readDatabase();
  let products = db.products || [];
  
  // Aplicar filtros
  if (q) {
    const needle = q.toLowerCase();
    products = products.filter(product =>
      product.mlb_id.toLowerCase().includes(needle) ||
      (product.product_name || '').toLowerCase().includes(needle) ||
      (product.product_code || '').toLowerCase().includes(needle)
    );
  }
  
  if (status && status !== 'all') {
    products = products.filter(product => product.status === status);
  }
  
  // Paginação
  const total = products.length;
  const start = (page - 1) * pageSize;
  const items = products.slice(start, start + pageSize);
  
  return { items, total, page, page_size: pageSize };
}

// Sincronizar produto com ML (buscar dados atualizados)
async function syncProductWithML(mlbId, token) {
  try {
    console.log(`${LOG_PREFIX} 🔄 Sincronizando ${mlbId} com ML...`);
    
    // Buscar dados do produto
    const itemResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!itemResponse.ok) {
      throw new Error(`Erro ${itemResponse.status} ao buscar produto`);
    }
    
    const item = await itemResponse.json();
    
    // Buscar estoque fulfillment
    let stockData = { available_quantity: 0, total: 0 };
    
    if (item.inventory_id) {
      const stockResponse = await fetch(`https://api.mercadolibre.com/inventories/${item.inventory_id}/stock/fulfillment`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (stockResponse.ok) {
        stockData = await stockResponse.json();
      }
    }
    
    // Atualizar produto no banco
    const updatedData = {
      mlb_id: item.id,
      product_name: item.title || '',
      image_url: item.pictures?.[0]?.url || item.thumbnail || '',
      price_cents: Math.round(Number(item.price || 0) * 100),
      available_quantity: Number(stockData.available_quantity || 0),
      status: item.status || 'active',
      inventory_id: item.inventory_id || '',
      is_full_stock: true // Se estamos sincronizando, assume que está no Full
    };
    
    const updated = await updateProduct(mlbId, updatedData);
    console.log(`${LOG_PREFIX} ✅ ${mlbId} sincronizado`);
    
    return updated;
    
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Erro ao sincronizar ${mlbId}:`, error.message);
    throw error;
  }
}

// Estatísticas do banco
async function getStats() {
  const db = await readDatabase();
  const products = db.products || [];
  
  const stats = {
    total_products: products.length,
    active_products: products.filter(p => p.status === 'active').length,
    no_stock_products: products.filter(p => p.available_quantity === 0).length,
    last_updated: db.metadata?.last_updated,
    total_stock_value_cents: products.reduce((sum, p) => sum + (p.price_cents * p.available_quantity), 0)
  };
  
  return stats;
}

module.exports = {
  getAllProducts,
  getProductByMLB,
  addProduct,
  removeProduct,
  updateProduct,
  searchProducts,
  syncProductWithML,
  getStats,
  readDatabase,
  writeDatabase
};