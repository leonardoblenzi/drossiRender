"use strict";

const bcrypt = require("bcryptjs");
const db = require("../db/db"); // ✅ seu wrapper expõe query + withClient

function env(name, fallback = "") {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function normalizeEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function truthy(v) {
  const s = String(v ?? "")
    .toLowerCase()
    .trim();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function normalizeRole(role) {
  const r = String(role || "")
    .toLowerCase()
    .trim();
  if (r === "owner" || r === "admin" || r === "operador") return r;
  return "owner";
}

/**
 * Bootstrap MASTER:
 * 1) Garante empresa "Master" (por nome) — select+insert (idempotente sem UNIQUE)
 * 2) Garante usuario MASTER (admin_master) via UPSERT por email UNIQUE
 * 3) Garante vinculo empresa_usuarios (papel owner/admin/operador) via UPSERT (PK composta)
 *
 * ENVs:
 * - ML_BOOTSTRAP_MASTER_EMAIL (obrig)
 * - ML_BOOTSTRAP_MASTER_PASSWORD (obrig)
 * - ML_BOOTSTRAP_MASTER_NAME (opcional, default "Master")
 * - ML_BOOTSTRAP_MASTER_UPDATE_PASSWORD (0|1, default 0)
 *
 * Extras (opcional):
 * - ML_BOOTSTRAP_MASTER_COMPANY_NAME (default "Master")
 * - ML_BOOTSTRAP_MASTER_COMPANY_ROLE (default "owner")
 */
async function ensureMasterUser() {
  const email = normalizeEmail(env("ML_BOOTSTRAP_MASTER_EMAIL"));
  const password = env("ML_BOOTSTRAP_MASTER_PASSWORD");
  const masterName = env("ML_BOOTSTRAP_MASTER_NAME", "Master");
  const updatePassword = truthy(
    env("ML_BOOTSTRAP_MASTER_UPDATE_PASSWORD", "0"),
  );

  const companyName = env("ML_BOOTSTRAP_MASTER_COMPANY_NAME", "Master");
  const companyRole = normalizeRole(
    env("ML_BOOTSTRAP_MASTER_COMPANY_ROLE", "owner"),
  );

  if (!email || !password) {
    console.warn("⚠️ [BOOTSTRAP] MASTER envs ausentes. Pulando bootstrap.");
    return { ok: false, skipped: true };
  }

  // hash sempre calculado; só aplicado no UPSERT se updatePassword=true
  const senha_hash = await bcrypt.hash(password, 10);

  return db.withClient(async (client) => {
    await client.query("BEGIN");
    try {
      // =========================================================
      // 1) EMPRESA MASTER (select+insert)
      // =========================================================
      const empSel = await client.query(
        `SELECT id, nome
           FROM empresas
          WHERE lower(nome) = lower($1)
          LIMIT 1`,
        [companyName],
      );

      let empresaId;
      if (empSel.rowCount > 0) {
        empresaId = empSel.rows[0].id;
      } else {
        const empIns = await client.query(
          `INSERT INTO empresas (nome)
           VALUES ($1)
           RETURNING id, nome`,
          [companyName],
        );
        empresaId = empIns.rows[0].id;
        console.log(
          `✅ [BOOTSTRAP] Empresa MASTER criada: ${companyName} (id=${empresaId})`,
        );
      }

      // =========================================================
      // 2) USUARIO MASTER (UPSERT por email UNIQUE)
      // =========================================================
      const userUpsert = await client.query(
        `
        INSERT INTO usuarios (nome, email, senha_hash, nivel)
        VALUES ($1, $2, $3, 'admin_master')
        ON CONFLICT (email) DO UPDATE
          SET nome  = EXCLUDED.nome,
              nivel = 'admin_master',
              senha_hash = CASE
                WHEN $4 THEN EXCLUDED.senha_hash
                ELSE usuarios.senha_hash
              END
        RETURNING id, email, nivel;
        `,
        [masterName, email, senha_hash, updatePassword],
      );

      const user = userUpsert.rows[0];
      const usuarioId = user.id;

      // =========================================================
      // 3) VINCULO empresa_usuarios (UPSERT PK composta)
      // =========================================================
      const vinc = await client.query(
        `
        INSERT INTO empresa_usuarios (empresa_id, usuario_id, papel)
        VALUES ($1, $2, $3)
        ON CONFLICT (empresa_id, usuario_id) DO UPDATE
          SET papel = EXCLUDED.papel
        RETURNING empresa_id, usuario_id, papel;
        `,
        [empresaId, usuarioId, companyRole],
      );

      await client.query("COMMIT");

      // ✅ logs sem senha
      console.log(
        `✅ [BOOTSTRAP] MASTER ok: ${email} (nivel=${user.nivel}, reset_senha=${
          updatePassword ? "SIM" : "NAO"
        })`,
      );
      console.log(
        `✅ [BOOTSTRAP] Vinculo ok: empresa_id=${vinc.rows[0].empresa_id} usuario_id=${vinc.rows[0].usuario_id} papel=${vinc.rows[0].papel}`,
      );

      return {
        ok: true,
        user,
        empresa: { id: empresaId, nome: companyName },
        vinculo: vinc.rows[0],
        passwordReset: !!updatePassword,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

module.exports = { ensureMasterUser };
