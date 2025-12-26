"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/db");

const router = express.Router();

/**
 * MASTER ONLY
 * - Só `admin_master` pode acessar o painel e CRUD do banco via web.
 * - `administrador` NÃO entra aqui (é apenas "usuário avançado" para liberar telas).
 *
 * Requisito: req.user precisa existir (ensureAuth do seu app injeta isso).
 */
function ensureMasterOnly(req, res, next) {
  const u = req.user || res.locals.user;

  // ✅ normaliza para evitar falha por case
  const nivel = String(u?.nivel || "").trim().toLowerCase();
  const isMaster = nivel === "admin_master" || u?.is_master === true;

  if (isMaster) return next();

  return res.status(403).json({ ok: false, error: "Acesso não autorizado." });
}

// Tudo aqui é só MASTER
router.use(ensureMasterOnly);

// Helpers
function isValidNivel(n) {
  const v = String(n || "").trim().toLowerCase();
  return ["usuario", "administrador", "admin_master"].includes(v);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeNome(nome) {
  const v = String(nome || "").trim();
  return v ? v : null;
}

// GET /api/admin/usuarios
router.get("/usuarios", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `select id, nome, email, nivel, criado_em, ultimo_login_em
         from usuarios
        order by id desc`
    );
    return res.json({ ok: true, usuarios: rows });
  } catch (err) {
    console.error("GET /api/admin/usuarios erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao listar usuários" });
  }
});

// POST /api/admin/usuarios
router.post("/usuarios", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const nome = normalizeNome(req.body?.nome);
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || "");
    const nivel = String(req.body?.nivel || "usuario").trim().toLowerCase();

    if (!email || !senha) {
      return res
        .status(400)
        .json({ ok: false, error: "Informe email e senha." });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "A senha deve ter no mínimo 6 caracteres.",
      });
    }

    if (!isValidNivel(nivel)) {
      return res.status(400).json({ ok: false, error: "Nível inválido." });
    }

    const senha_hash = await bcrypt.hash(senha, 10);

    const { rows } = await db.query(
      `insert into usuarios (nome, email, senha_hash, nivel)
       values ($1, $2, $3, $4)
       returning id, nome, email, nivel, criado_em, ultimo_login_em`,
      [nome, email, senha_hash, nivel]
    );

    return res.json({ ok: true, usuario: rows[0] });
  } catch (err) {
    if (String(err.code) === "23505") {
      return res
        .status(409)
        .json({ ok: false, error: "Email já cadastrado." });
    }
    console.error("POST /api/admin/usuarios erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao criar usuário" });
  }
});

// PUT /api/admin/usuarios/:id  (edita dados e opcionalmente troca senha)
router.put("/usuarios/:id", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const requesterId = Number(req.user?.uid);

    const nome =
      req.body?.nome !== undefined ? normalizeNome(req.body.nome) : undefined;

    const email =
      req.body?.email !== undefined
        ? normalizeEmail(req.body.email)
        : undefined;

    const nivel =
      req.body?.nivel !== undefined
        ? String(req.body.nivel).trim().toLowerCase()
        : undefined;

    const senha =
      req.body?.senha !== undefined ? String(req.body.senha) : undefined;

    if (nivel !== undefined && !isValidNivel(nivel)) {
      return res.status(400).json({ ok: false, error: "Nível inválido." });
    }

    // ✅ Segurança: evitar você mesmo rebaixar seu master e se trancar fora
    if (
      Number.isFinite(requesterId) &&
      requesterId === id &&
      nivel !== undefined &&
      nivel !== "admin_master"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Você não pode rebaixar seu próprio admin_master.",
      });
    }

    // monta update dinâmico
    const sets = [];
    const params = [];
    let i = 1;

    if (nome !== undefined) {
      sets.push(`nome = $${i++}`);
      params.push(nome);
    }
    if (email !== undefined) {
      sets.push(`email = $${i++}`);
      params.push(email);
    }
    if (nivel !== undefined) {
      sets.push(`nivel = $${i++}`);
      params.push(nivel);
    }

    if (senha !== undefined && senha.length > 0) {
      if (senha.length < 6) {
        return res.status(400).json({
          ok: false,
          error: "A senha deve ter no mínimo 6 caracteres.",
        });
      }
      const senha_hash = await bcrypt.hash(senha, 10);
      sets.push(`senha_hash = $${i++}`);
      params.push(senha_hash);
    }

    if (sets.length === 0) {
      return res.status(400).json({ ok: false, error: "Nada para atualizar." });
    }

    params.push(id);

    const { rows } = await db.query(
      `update usuarios
          set ${sets.join(", ")}
        where id = $${i}
      returning id, nome, email, nivel, criado_em, ultimo_login_em`,
      params
    );

    if (!rows[0]) {
      return res
        .status(404)
        .json({ ok: false, error: "Usuário não encontrado" });
    }

    return res.json({ ok: true, usuario: rows[0] });
  } catch (err) {
    if (String(err.code) === "23505") {
      return res
        .status(409)
        .json({ ok: false, error: "Email já cadastrado." });
    }
    console.error("PUT /api/admin/usuarios/:id erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao atualizar usuário" });
  }
});

// DELETE /api/admin/usuarios/:id
router.delete("/usuarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const requesterId = Number(req.user?.uid);

    // impedir master apagar ele mesmo
    if (Number.isFinite(requesterId) && requesterId === id) {
      return res.status(400).json({
        ok: false,
        error: "Você não pode remover seu próprio usuário.",
      });
    }

    // Segurança: não permitir deletar admin_master via painel (evita acidentes)
    const chk = await db.query(`select id, nivel from usuarios where id = $1`, [
      id,
    ]);
    const target = chk.rows[0];
    if (!target) {
      return res
        .status(404)
        .json({ ok: false, error: "Usuário não encontrado" });
    }

    if (String(target.nivel || "").trim().toLowerCase() === "admin_master") {
      return res.status(400).json({
        ok: false,
        error:
          "Por segurança, não é permitido remover um admin_master via painel.",
      });
    }

    const { rowCount } = await db.query(`delete from usuarios where id = $1`, [
      id,
    ]);
    if (!rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "Usuário não encontrado" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/usuarios/:id erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao remover usuário" });
  }
});

module.exports = router;
