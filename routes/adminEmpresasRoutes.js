"use strict";

const express = require("express");
const db = require("../db/db");

const router = express.Router();

/**
 * MASTER ONLY (defesa em profundidade)
 * Requisito: ensureAuth injeta req.user
 */
function ensureMasterOnly(req, res, next) {
  const u = req.user || res.locals.user;
  const nivel = String(u?.nivel || "").trim().toLowerCase();
  if (nivel === "admin_master") return next();
  return res.status(403).json({ ok: false, error: "Acesso não autorizado." });
}

router.use(ensureMasterOnly);

// GET /api/admin/empresas
router.get("/empresas", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `
      select
        e.id,
        e.nome,
        e.criado_em,
        (
          select count(*)::int
          from empresa_usuarios eu
          where eu.empresa_id = e.id
        ) as usuarios_count,
        (
          select count(*)::int
          from meli_contas c
          where c.empresa_id = e.id
        ) as contas_ml_count
      from empresas e
      order by e.id desc
      `
    );

    return res.json({ ok: true, empresas: rows });
  } catch (err) {
    console.error("GET /api/admin/empresas erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar empresas" });
  }
});

// POST /api/admin/empresas
router.post("/empresas", express.json({ limit: "200kb" }), async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();

    if (!nome) {
      return res.status(400).json({ ok: false, error: "Informe o nome da empresa." });
    }

    const { rows } = await db.query(
      `
      insert into empresas (nome)
      values ($1)
      returning id, nome, criado_em
      `,
      [nome]
    );

    return res.json({ ok: true, empresa: rows[0] });
  } catch (err) {
    if (String(err.code) === "23505") {
      return res.status(409).json({ ok: false, error: "Empresa já cadastrada." });
    }
    console.error("POST /api/admin/empresas erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao criar empresa" });
  }
});

// PUT /api/admin/empresas/:id
router.put("/empresas/:id", express.json({ limit: "200kb" }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const nome = String(req.body?.nome || "").trim();
    if (!nome) {
      return res.status(400).json({ ok: false, error: "Informe o nome da empresa." });
    }

    const { rows } = await db.query(
      `
      update empresas
         set nome = $1
       where id = $2
      returning id, nome, criado_em
      `,
      [nome, id]
    );

    if (!rows[0]) return res.status(404).json({ ok: false, error: "Empresa não encontrada" });

    return res.json({ ok: true, empresa: rows[0] });
  } catch (err) {
    if (String(err.code) === "23505") {
      return res.status(409).json({ ok: false, error: "Já existe uma empresa com esse nome." });
    }
    console.error("PUT /api/admin/empresas/:id erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao atualizar empresa" });
  }
});

// DELETE /api/admin/empresas/:id
router.delete("/empresas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    // bloqueia remoção se tiver vínculos/contas
    const deps = await db.query(
      `
      select
        (select count(*)::int from empresa_usuarios where empresa_id = $1) as usuarios_count,
        (select count(*)::int from meli_contas where empresa_id = $1) as contas_ml_count
      `,
      [id]
    );

    const usuarios = deps.rows?.[0]?.usuarios_count || 0;
    const contas = deps.rows?.[0]?.contas_ml_count || 0;

    if (usuarios > 0 || contas > 0) {
      return res.status(400).json({
        ok: false,
        error: `Não é permitido remover: empresa possui ${usuarios} usuário(s) e ${contas} conta(s) ML vinculada(s).`,
      });
    }

    const { rowCount } = await db.query(`delete from empresas where id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: "Empresa não encontrada" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/empresas/:id erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao remover empresa" });
  }
});

module.exports = router;
