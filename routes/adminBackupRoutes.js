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

/**
 * GET /api/admin/backup/export.json
 * Exporta backup JSON por tabelas (fallback universal)
 */
router.get("/backup/export.json", async (_req, res) => {
  try {
    // Ordem boa pra restore
    const tables = [
      "empresas",
      "usuarios",
      "empresa_usuarios",
      "meli_contas",
      "meli_tokens",
      "oauth_states",
      "migracoes",
    ];

    const pack = {};
    for (const t of tables) {
      const r = await db.query(`select * from ${t}`);
      pack[t] = r.rows || [];
    }

    const payload = {
      ok: true,
      format: "davantti_backup_json_v1",
      created_at: new Date().toISOString(),
      tables,
      data: pack,
    };

    const filename = `davantti_db_backup_${nowStamp()}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("GET /api/admin/backup/export.json erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao exportar backup." });
  }
});

/**
 * POST /api/admin/backup/import.json
 * body: { backup: {...} }  OU multipart (se preferir)
 * Restaura por JSON (wipe & restore) - MASTER ONLY
 */
router.post("/backup/import.json", express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const backup = req.body?.backup;
    if (!backup || backup.format !== "davantti_backup_json_v1") {
      return res.status(400).json({ ok: false, error: "Backup inválido (formato)." });
    }

    const data = backup.data || {};
    const tables = backup.tables || [];

    // Travinha: só aceitamos as tabelas conhecidas
    const allowed = new Set([
      "empresas",
      "usuarios",
      "empresa_usuarios",
      "meli_contas",
      "meli_tokens",
      "oauth_states",
      "migracoes",
    ]);

    for (const t of tables) {
      if (!allowed.has(t)) {
        return res.status(400).json({ ok: false, error: `Tabela não permitida no restore: ${t}` });
      }
    }

    await db.withClient(async (client) => {
      await client.query("begin");
      try {
        // 1) desliga constraints (mais fácil), depois liga
        await client.query("set session_replication_role = replica");

        // 2) limpa na ordem inversa (FK)
        const delOrder = [
          "oauth_states",
          "meli_tokens",
          "meli_contas",
          "empresa_usuarios",
          "usuarios",
          "empresas",
          "migracoes",
        ];
        for (const t of delOrder) {
          await client.query(`delete from ${t}`);
        }

        // 3) insere na ordem correta
        const insOrder = [
          "empresas",
          "usuarios",
          "empresa_usuarios",
          "meli_contas",
          "meli_tokens",
          "oauth_states",
          "migracoes",
        ];

        for (const t of insOrder) {
          const rows = Array.isArray(data[t]) ? data[t] : [];
          if (!rows.length) continue;

          // monta insert dinâmico
          const cols = Object.keys(rows[0]);
          const colSql = cols.map((c) => `"${c}"`).join(", ");

          // insere em batches
          const chunkSize = 500;
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
              `insert into ${t} (${colSql}) values ${values.join(", ")}`
              ,
              params
            );
          }
        }

        // 4) religa constraints
        await client.query("set session_replication_role = origin");

        // 5) ajusta sequences (ids bigserial)
        // Ajusta apenas as tabelas com id serial
        await client.query(`
          select setval('public.empresas_id_seq', coalesce((select max(id) from empresas), 0) + 1, false);
        `);
        await client.query(`
          select setval('public.usuarios_id_seq', coalesce((select max(id) from usuarios), 0) + 1, false);
        `);
        await client.query(`
          select setval('public.meli_contas_id_seq', coalesce((select max(id) from meli_contas), 0) + 1, false);
        `);
        await client.query(`
          select setval('public.migracoes_id_seq', coalesce((select max(id) from migracoes), 0) + 1, false);
        `);

        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/backup/import.json erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao importar backup." });
  }
});

module.exports = router;
