// routes/authRoutes.js
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não definido. Configure no .env / Render Environment.');
}

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd, // em produção (https), true
    maxAge: 1000 * 60 * 60 * 12, // 12h
    path: '/',
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');

    if (!email || !senha) {
      return res.status(400).json({ ok: false, error: 'Informe email e senha.' });
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
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
    }

    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
    }

    // Atualiza último login
    await db.query(`update usuarios set ultimo_login_em = now() where id = $1`, [user.id]);

    const token = signToken({
      uid: user.id,
      email: user.email,
      nivel: user.nivel, // 'usuario' | 'administrador'
      nome: user.nome || null,
    });

    res.cookie('auth_token', token, cookieOptions());

    return res.json({
      ok: true,
      user: { id: user.id, nome: user.nome, email: user.email, nivel: user.nivel },
      redirect: '/select-conta', // após login -> seleção de conta ML
    });
  } catch (err) {
    console.error('POST /api/auth/login erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno ao fazer login.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('auth_token', {
    path: '/',
    sameSite: 'lax',
    secure: isProd,
  });
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
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
