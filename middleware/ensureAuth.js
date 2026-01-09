"use strict";

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET não definido. Configure no .env / Render Environment."
  );
}

/**
 * Rotas/paths que PRECISAM ser públicas, senão você não consegue:
 * - abrir login/cadastro
 * - carregar CSS/JS/IMG do login
 * - usar /api/auth pra autenticar
 *
 * ✅ IMPORTANTE (Render):
 * O Render faz healthcheck SEM cookies. Então /api/system/health PRECISA passar 200.
 * Senão o deploy fica "Waiting for internal health check..." e falha por timeout.
 */
const PUBLIC_PATHS = [
  // ✅ Render healthcheck (DEVE ser público)
  /^\/api\/system\/health(?:\/|$)/i,
  /^\/api\/system\/stats(?:\/|$)/i,
  /^\/healthz(?:\/|$)/i,

  // páginas públicas
  /^\/(?:login|cadastro|selecao-plataforma)(?:\/|$)/i,

  // auth do app
  /^\/api\/auth(?:\/|$)/i,

  // assets estáticos (necessários pro login/cadastro)
  /^\/(?:css|js|img|fonts)(?:\/|$)/i,

  // favicon
  /^\/favicon\.ico$/i,
];

const SKIP_METHODS = new Set(["OPTIONS", "HEAD"]);

function isPublic(req) {
  if (SKIP_METHODS.has(req.method)) return true;
  const p = req.path || req.originalUrl || "";
  return PUBLIC_PATHS.some((rx) => rx.test(p));
}

function readToken(req) {
  return req.cookies?.auth_token || null;
}

function wantsHtml(req) {
  const accept = String(req.headers?.accept || "").toLowerCase();
  return (
    accept.includes("text/html") || accept.includes("application/xhtml+xml")
  );
}

function isApiCall(req) {
  const p = req.path || req.originalUrl || "";
  const accept = String(req.headers?.accept || "").toLowerCase();
  const xrw = String(req.headers?.["x-requested-with"] || "").toLowerCase();
  return (
    p.startsWith("/api/") ||
    accept.includes("application/json") ||
    xrw === "xmlhttprequest"
  );
}

function clearAuthCookie(res) {
  res.clearCookie("auth_token", { path: "/" });
}

function unauthorized(req, res, reason = "Não autenticado") {
  // ✅ API/fetch: NUNCA redirecionar (senão volta HTML e quebra seu front)
  if (isApiCall(req) || !wantsHtml(req) || req.method !== "GET") {
    return res.status(401).json({
      ok: false,
      error: reason,
      redirect: "/login",
    });
  }

  // ✅ navegação (GET HTML): pode redirecionar
  return res.redirect("/login");
}

function ensureAuth(req, res, next) {
  // ✅ deixa público apenas o essencial
  if (isPublic(req)) return next();

  try {
    const token = readToken(req);
    if (!token) return unauthorized(req, res, "Token ausente");

    const payload = jwt.verify(token, JWT_SECRET);

    req.user = payload; // { uid, email, nivel, nome, iat, exp }
    res.locals.user = payload;

    return next();
  } catch (err) {
    clearAuthCookie(res);
    return unauthorized(req, res, "Token inválido ou expirado");
  }
}

// Exige um nível específico (se quiser usar em alguma view/rota)
function requireNivel(nivelNecessario) {
  return function (req, res, next) {
    const u = req.user || res.locals.user;
    if (!u) return unauthorized(req, res, "Não autenticado");

    if (String(u.nivel) !== String(nivelNecessario)) {
      if (!isApiCall(req) && wantsHtml(req) && req.method === "GET") {
        return res.redirect("/nao-autorizado");
      }
      return res.status(403).json({ ok: false, error: "Acesso negado." });
    }

    return next();
  };
}

const ensureAdmin = requireNivel("administrador");

module.exports = {
  ensureAuth,
  requireNivel,
  ensureAdmin,
};
