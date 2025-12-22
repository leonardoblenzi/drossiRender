// db/migrate.js
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function sslConfig() {
  // Render normalmente exige SSL. Local pode não exigir.
  // Se você tiver DATABASE_URL do Render em local, isso ajuda a conectar.
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const hasDbUrl = !!process.env.DATABASE_URL;

  // Se você estiver no Render, geralmente NODE_ENV=production e DATABASE_URL vem com SSL.
  if (isProd || hasDbUrl) {
    return { rejectUnauthorized: false };
  }
  return false;
}

async function ensureMigracoesTable(client) {
  await client.query(`
    create table if not exists migracoes (
      id bigserial primary key,
      arquivo text not null unique,
      aplicado_em timestamptz not null default now()
    );
  `);
}

async function alreadyApplied(client, arquivo) {
  const r = await client.query('select 1 from migracoes where arquivo = $1 limit 1', [arquivo]);
  return r.rowCount > 0;
}

async function markApplied(client, arquivo) {
  await client.query('insert into migracoes (arquivo) values ($1) on conflict do nothing', [arquivo]);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL não encontrado. Configure no .env (local) ou no Render (Environment).');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: sslConfig(),
  });

  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));

  if (files.length === 0) {
    console.log('⚠️ Nenhuma migração encontrada em /db (padrão: 001_nome.sql).');
    return;
  }

  await client.connect();

  try {
    await ensureMigracoesTable(client);

    console.log(`📦 Encontradas ${files.length} migrações.`);
    for (const file of files) {
      const full = path.join(migrationsDir, file);

      if (await alreadyApplied(client, file)) {
        console.log(`↩️  Pulando (já aplicada): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(full, 'utf8');
      console.log(`▶️  Aplicando: ${file}`);

      await client.query('begin');
      try {
        await client.query(sql);
        await markApplied(client, file);
        await client.query('commit');
        console.log(`✅ OK: ${file}`);
      } catch (e) {
        await client.query('rollback');
        console.error(`❌ Falhou: ${file}`);
        throw e;
      }
    }

    console.log('🎉 Migrações finalizadas com sucesso.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Erro nas migrações:', err.message);
  process.exit(1);
});
