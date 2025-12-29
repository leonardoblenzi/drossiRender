// db/migrate.js
"use strict";
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

/**
 * Decide SSL de forma segura:
 * - Render/produção normalmente exige SSL
 * - Se a DATABASE_URL tiver sslmode=require, usa SSL mesmo em dev
 * - Caso contrário (ex.: Postgres local), não força SSL
 */
function sslConfig(databaseUrl) {
  const isProd =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const wantsSsl = isProd || /sslmode=require/i.test(databaseUrl || "");
  return wantsSsl ? { rejectUnauthorized: false } : false;
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

/**
 * Se existir a tabela antiga schema_migrations, migra os registros para migracoes
 * e remove a tabela antiga para evitar ambiguidade.
 * (Idempotente: pode rodar mais de uma vez.)
 */
async function consolidateSchemaMigrations(client) {
  await client.query(`
    do $$
    begin
      if exists (
        select 1
          from information_schema.tables
         where table_schema = 'public'
           and table_name = 'schema_migrations'
      ) then
        -- Copia histórico pra tabela oficial
        insert into public.migracoes (arquivo, aplicado_em)
        select filename, coalesce(applied_at, now())
          from public.schema_migrations
        on conflict (arquivo) do nothing;

        -- Remove tabela antiga pra não confundir
        drop table public.schema_migrations;
      end if;
    end $$;
  `);
}

async function alreadyApplied(client, arquivo) {
  const r = await client.query(
    "select 1 from public.migracoes where arquivo = $1 limit 1",
    [arquivo]
  );
  return r.rowCount > 0;
}

async function markApplied(client, arquivo) {
  await client.query(
    "insert into public.migracoes (arquivo) values ($1) on conflict do nothing",
    [arquivo]
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "❌ DATABASE_URL não encontrado. Configure no .env (local) ou no Render (Environment)."
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: sslConfig(databaseUrl),
  });

  const migrationsDir = __dirname;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (files.length === 0) {
    console.log(
      "⚠️ Nenhuma migração encontrada em /db (padrão: 001_nome.sql)."
    );
    return;
  }

  await client.connect();

  try {
    await ensureMigracoesTable(client);

    // ✅ Consolida schema_migrations -> migracoes (se existir) e remove a antiga
    await consolidateSchemaMigrations(client);

    console.log(`📦 Encontradas ${files.length} migrações.`);
    for (const file of files) {
      const full = path.join(migrationsDir, file);

      if (await alreadyApplied(client, file)) {
        console.log(`↩️  Pulando (já aplicada): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(full, "utf8");
      console.log(`▶️  Aplicando: ${file}`);

      await client.query("begin");
      try {
        await client.query(sql);
        await markApplied(client, file);
        await client.query("commit");
        console.log(`✅ OK: ${file}`);
      } catch (e) {
        await client.query("rollback");
        console.error(`❌ Falhou: ${file}`);
        throw e;
      }
    }

    console.log("🎉 Migrações finalizadas com sucesso.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Erro nas migrações:", err.message);
  process.exit(1);
});
