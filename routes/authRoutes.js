// routes/authRoutes.js
"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db/db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET não definido. Configure no .env / Render Environment."
  );
}

const isProd =
  String(process.env.NODE_ENV || "").toLowerCase() === "production";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // em produção (https), true
    maxAge: 1000 * 60 * 60 * 12, // 12h
    path: "/",
  };
}

/**
 * POST /api/auth/register
 * body: { nome, email, senha, empresa_nome }
 *
 * Cria:
 * - usuario
 * - empresa
 * - empresa_usuarios (owner)
 * E já autentica (seta cookie auth_token).
 */
router.post("/register", express.json({ limit: "1mb" }), async (req, res) => {
  const nome = String(req.body?.nome || "").trim() || null;
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const senha = String(req.body?.senha || "");
  const empresa_nome = String(req.body?.empresa_nome || "").trim();

  if (!email || !senha || !empresa_nome) {
    return res.status(400).json({
      ok: false,
      error: "Informe email, senha e nome da empresa.",
    });
  }

  if (senha.length < 6) {
    return res.status(400).json({
      ok: false,
      error: "A senha deve ter no mínimo 6 caracteres.",
    });
  }

  try {
    // Transação: cria usuário + empresa + vínculo
    const result = await db.withClient(async (client) => {
      await client.query("begin");

      try {
        // 1) cria usuário
        const senha_hash = await bcrypt.hash(senha, 10);

        const u = await client.query(
          `insert into usuarios (nome, email, senha_hash, nivel)
           values ($1, $2, $3, 'usuario')
           returning id, nome, email, nivel, criado_em`,
          [nome, email, senha_hash]
        );

        const user = u.rows[0];

        // 2) cria empresa
        const e = await client.query(
          `insert into empresas (nome)
           values ($1)
           returning id, nome, criado_em`,
          [empresa_nome]
        );

        const empresa = e.rows[0];

        // 3) vínculo usuário -> empresa (owner)
        await client.query(
          `insert into empresa_usuarios (empresa_id, usuario_id, papel)
           values ($1, $2, 'owner')
           on conflict do nothing`,
          [empresa.id, user.id]
        );

        await client.query("commit");

        return { user, empresa };
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    });

    const { user } = result;

    // já autentica
    const token = signToken({
      uid: user.id,
      email: user.email,
      nivel: user.nivel,
      nome: user.nome || null,
    });

    res.cookie("auth_token", token, cookieOptions());

    return res.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        nivel: user.nivel,
      },
      redirect: "/vincular-conta",
    });
  } catch (err) {
    // unique violation (email)
    if (String(err.code) === "23505") {
      return res.status(409).json({ ok: false, error: "Email já cadastrado." });
    }
    console.error("POST /api/auth/register erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro interno ao cadastrar." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const senha = String(req.body?.senha || "");

    if (!email || !senha) {
      return res
        .status(400)
        .json({ ok: false, error: "Informe email e senha." });
    }

    const { rows } = await db.query(
      `select id, nome, email, senha_hash, nivel
         from usuarios
        where email = $1
        limit 1`,
      [email]
    );

    const user = rows[0];
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Credenciais inválidas." });
    }

    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ ok: false, error: "Credenciais inválidas." });
    }

    // Atualiza último login
    await db.query(
      `update usuarios set ultimo_login_em = now() where id = $1`,
      [user.id]
    );

    const token = signToken({
      uid: user.id,
      email: user.email,
      nivel: user.nivel, // 'usuario' | 'administrador'
      nome: user.nome || null,
    });

    res.cookie("auth_token", token, cookieOptions());

    return res.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        nivel: user.nivel,
      },
      redirect: "/select-conta", // mantém seu fluxo atual
    });
  } catch (err) {
    console.error("POST /api/auth/login erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro interno ao fazer login." });
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.clearCookie("auth_token", {
    path: "/",
    sameSite: "lax",
    secure: isProd,
  });
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return res.json({ ok: true, logged: false });

    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ ok: true, logged: true, user: payload });
  } catch {
    return res.json({ ok: true, logged: false });
  }
});

module.exports = router;
