// middleware/ensureAuth.js
"use strict";

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET não definido. Configure no .env / Render Environment."
  );
}

function readToken(req) {
  return req.cookies?.auth_token || null;
}

/** Detecta se a requisição espera HTML (página) ou JSON (API/fetch) */
function wantsHtml(req) {
  // - Browsers em navegação geralmente aceitam text/html
  // - Fetch/axios costuma mandar Accept: application/json (ou */*)
  const a = req.accepts(["html", "json"]);
  return a === "html";
}

function isApiCall(req) {
  const path = req.path || req.originalUrl || "";
  const accept = String(req.headers?.accept || "");
  const xrw = String(req.headers?.["x-requested-with"] || "");
  return (
    path.startsWith("/api/") ||
    accept.includes("application/json") ||
    xrw.toLowerCase() === "xmlhttprequest"
  );
}

function clearAuthCookie(res) {
  res.clearCookie("auth_token", { path: "/" });
}

function unauthorized(req, res, reason = "Não autenticado") {
  // Para API/fetch: NUNCA redirecionar (senão volta HTML e quebra o front)
  if (isApiCall(req) || !wantsHtml(req) || req.method !== "GET") {
    return res.status(401).json({
      ok: false,
      error: reason,
      redirect: "/login",
    });
  }

  // Para navegação de página (GET): pode redirecionar
  return res.redirect("/login");
}

function ensureAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return unauthorized(req, res, "Token ausente");

    const payload = jwt.verify(token, JWT_SECRET);

    // Deixa disponível para o resto do app
    req.user = payload; // { uid, email, nivel, nome, iat, exp }
    res.locals.user = payload;

    return next();
  } catch (err) {
    // token inválido/expirado
    clearAuthCookie(res);
    return unauthorized(req, res, "Token inválido ou expirado");
  }
}

// Exige um nível específico (por enquanto só temos 'usuario' e 'administrador')
function requireNivel(nivelNecessario) {
  return function (req, res, next) {
    const u = req.user || res.locals.user;
    if (!u) return unauthorized(req, res, "Não autenticado");

    if (String(u.nivel) !== String(nivelNecessario)) {
      // HTML: pode redirecionar para uma página 403 se você quiser,
      // mas por ora mantemos JSON para API.
      if (!isApiCall(req) && wantsHtml(req) && req.method === "GET") {
        return res.redirect("/nao-autorizado");
      }

      return res.status(403).json({ ok: false, error: "Acesso negado." });
    }

    return next();
  };
}

// Atalho: admin
const ensureAdmin = requireNivel("administrador");

module.exports = {
  ensureAuth,
  requireNivel,
  ensureAdmin,
};
