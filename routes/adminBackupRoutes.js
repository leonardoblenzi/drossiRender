"use strict";

const express = require("express");
const db = require("../db/db");

const router = express.Router();

// IMPORTANTE: gate master é aplicado no index.js via:
// app.use("/api/admin", ensureMasterOnly, adminUsuariosRoutes);
// app.use("/api/admin", ensureMasterOnly, adminBackupRoutes);

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const ALLOWED_TABLES = [
  "empresas",
  "usuarios",
  "empresa_usuarios",
  "meli_contas",
  "meli_tokens",
  "oauth_states",
  "migracoes",
];

// ordem boa pra inserir respeitando FK
const INSERT_ORDER = [
  "empresas",
  "usuarios",
  "empresa_usuarios",
  "meli_contas",
  "meli_tokens",
  "oauth_states",
  "migracoes",
];

// ======================================================================
// Helpers
// ======================================================================
async function getTableColumns(client, tableName) {
  const r = await client.query(
    `
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = $1
     order by ordinal_position
    `,
    [tableName]
  );
  return new Set((r.rows || []).map((x) => x.column_name));
}

function pickColumns(availableColsSet, rowObj) {
  // pega só colunas que existem na tabela atual (evita quebrar por coluna antiga)
  const cols = Object.keys(rowObj || {}).filter((c) => availableColsSet.has(c));
  return cols;
}

async function bumpSerial(client, table, idCol = "id") {
  const seq = (
    await client.query(`select pg_get_serial_sequence($1, $2) as seq`, [
      `public.${table}`,
      idCol,
    ])
  ).rows?.[0]?.seq;

  if (!seq) return; // tabela pode não ter serial

  // setval(seq, max(id), true) -> próximo nextval = max+1
  await client.query(
    `
    select setval($1,
      coalesce((select max(${idCol}) from ${table}), 0),
      true
    )
    `,
    [seq]
  );
}

// ======================================================================
// GET /api/admin/backup/export.json
// Exporta backup JSON por tabelas (com order by id asc quando existir)
// ======================================================================
router.get("/backup/export.json", async (_req, res) => {
  try {
    const tables = [...ALLOWED_TABLES];

    const payload = await db.withClient(async (client) => {
      const tableCols = {};
      for (const t of tables) {
        tableCols[t] = await getTableColumns(client, t);
      }

      const pack = {};
      for (const t of tables) {
        const hasId = tableCols[t].has("id");
        const sql = hasId
          ? `select * from ${t} order by id asc`
          : `select * from ${t}`;
        const r = await client.query(sql);
        pack[t] = r.rows || [];
      }

      return {
        ok: true,
        format: "davantti_backup_json_v1",
        created_at: new Date().toISOString(),
        tables,
        data: pack,
      };
    });

    const filename = `davantti_db_backup_${nowStamp()}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("GET /api/admin/backup/export.json erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao exportar backup." });
  }
});

// ======================================================================
// POST /api/admin/backup/import.json
// body: { backup: {...} }
// Restaura (wipe & restore) - MASTER ONLY (via gate do index.js)
// Retorna resumo: { inserted: {tabela: n}, total_inserted, truncated: [...] }
// ======================================================================
router.post(
  "/backup/import.json",
  express.json({ limit: "50mb" }),
  async (req, res) => {
    try {
      const backup = req.body?.backup;

      if (!backup || backup.format !== "davantti_backup_json_v1") {
        return res
          .status(400)
          .json({ ok: false, error: "Backup inválido (formato)." });
      }

      const data = backup.data || {};
      const tables = Array.isArray(backup.tables) ? backup.tables : [];

      // travinha: só aceitamos as tabelas conhecidas
      const allowedSet = new Set(ALLOWED_TABLES);
      for (const t of tables) {
        if (!allowedSet.has(t)) {
          return res.status(400).json({
            ok: false,
            error: `Tabela não permitida no restore: ${t}`,
          });
        }
      }

      // Se o backup veio sem tables, assume allowed
      const usedTables = tables.length > 0 ? tables : [...ALLOWED_TABLES];

      const summary = await db.withClient(async (client) => {
        await client.query("begin");
        try {
          const inserted = {};
          for (const t of ALLOWED_TABLES) inserted[t] = 0;

          // 1) Limpa tudo (CASCADE + restart identity)
          await client.query(
            `truncate ${ALLOWED_TABLES.join(", ")} restart identity cascade`
          );

          // 2) Pré-carrega colunas (para ignorar colunas antigas do backup)
          const tableCols = {};
          for (const t of ALLOWED_TABLES) {
            tableCols[t] = await getTableColumns(client, t);
          }

          // 3) Insere na ordem correta
          const chunkSize = 500;

          for (const t of INSERT_ORDER) {
            if (!usedTables.includes(t)) continue;

            const rows = Array.isArray(data[t]) ? data[t] : [];
            if (!rows.length) continue;

            const cols = pickColumns(tableCols[t], rows[0]);
            if (!cols.length) continue;

            const colSql = cols.map((c) => `"${c}"`).join(", ");

            for (let i = 0; i < rows.length; i += chunkSize) {
              const chunk = rows.slice(i, i + chunkSize);

              const values = [];
              const params = [];
              let p = 1;

              for (const row of chunk) {
                const tuple = [];
                for (const c of cols) {
                  tuple.push(`$${p++}`);
                  params.push(row[c]);
                }
                values.push(`(${tuple.join(", ")})`);
              }

              await client.query(
                `insert into ${t} (${colSql}) values ${values.join(", ")}`,
                params
              );

              inserted[t] += chunk.length;
            }
          }

          // 4) Ajusta sequences (apenas onde faz sentido)
          await bumpSerial(client, "empresas", "id");
          await bumpSerial(client, "usuarios", "id");
          await bumpSerial(client, "meli_contas", "id");
          await bumpSerial(client, "migracoes", "id");

          await client.query("commit");

          const totalInserted = Object.values(inserted).reduce(
            (a, b) => a + b,
            0
          );

          return {
            inserted,
            total_inserted: totalInserted,
            truncated: [...ALLOWED_TABLES],
          };
        } catch (e) {
          try {
            await client.query("rollback");
          } catch {}
          throw e;
        }
      });

      return res.json({ ok: true, ...summary });
    } catch (err) {
      console.error("POST /api/admin/backup/import.json erro:", err);
      return res.status(500).json({
        ok: false,
        error: `Erro ao importar backup. ${err?.message || ""}`.trim(),
      });
    }
  }
);

module.exports = router;
