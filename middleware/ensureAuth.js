// middleware/ensureAuth.js
'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não definido. Configure no .env / Render Environment.');
}

function readToken(req) {
  return req.cookies?.auth_token || null;
}

function ensureAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.redirect('/login');

    const payload = jwt.verify(token, JWT_SECRET);

    // deixa disponível para o resto do app
    req.user = payload;              // { uid, email, nivel, nome, iat, exp }
    res.locals.user = payload;

    return next();
  } catch (err) {
    // token inválido/expirado
    res.clearCookie('auth_token', { path: '/' });
    return res.redirect('/login');
  }
}

// Exige um nível específico (por enquanto só temos 'usuario' e 'administrador')
function requireNivel(nivelNecessario) {
  return function (req, res, next) {
    // garante que o ensureAuth rodou antes
    const u = req.user || res.locals.user;
    if (!u) return res.redirect('/login');

    if (String(u.nivel) !== String(nivelNecessario)) {
      // você pode trocar por uma página 403, se quiser
      return res.status(403).json({ ok: false, error: 'Acesso negado.' });
    }

    return next();
  };
}

// Atalho: admin
const ensureAdmin = requireNivel('administrador');

module.exports = {
  ensureAuth,
  requireNivel,
  ensureAdmin,
};
