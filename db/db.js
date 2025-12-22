// db/db.js
// Conexão Postgres (Render) via DATABASE_URL
'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure no Render (Environment).');
}

// No Render, é comum precisar SSL (principalmente se usar External Database URL).
// Com Internal Database URL, geralmente funciona também com SSL ligado.
// Então deixamos SSL habilitado em produção por segurança.
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
  // opcional: ajuste fino
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Log básico de erro do pool
pool.on('error', (err) => {
  console.error('❌ Postgres pool error:', err);
});

// Helper simples
async function query(text, params) {
  return pool.query(text, params);
}

// Helper para transação / client dedicado
async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withClient,
};
