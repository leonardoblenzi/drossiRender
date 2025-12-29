// middleware/ensurePermission.js
"use strict";

/**
 * Gate único e reutilizável para permissões.
 * Fonte da verdade: req.user (injetado pelo ensureAuth) ou res.locals.user.
 *
 * Níveis aceitos:
 * - "usuario" (ou vazio) -> padrao
 * - "administrador" ou "admin" -> admin
 * - "admin_master" -> master
 */

function resolveNivel(req, res) {
  const u = req.user || res.locals.user || {};
  const raw = String(u.nivel || "")
    .trim()
    .toLowerCase();

  if (raw === "admin_master" || raw === "master") return "master";
  if (raw === "administrador" || raw === "admin") return "admin";
  return "padrao";
}

function wantsHtml(req) {
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

function deny(req, res, reason = "Acesso não autorizado.") {
  // Para API/fetch: 403 JSON
  if (isApiCall(req) || !wantsHtml(req) || req.method !== "GET") {
    return res.status(403).json({
      ok: false,
      error: reason,
      redirect: "/nao-autorizado",
    });
  }

  // Para navegação de página (GET): redirect
  return res.redirect("/nao-autorizado");
}

function requireAdmin() {
  return function (req, res, next) {
    const nivel = resolveNivel(req, res);
    const ok = nivel === "admin" || nivel === "master";
    if (ok) return next();
    return deny(req, res);
  };
}

function requireMaster() {
  return function (req, res, next) {
    const nivel = resolveNivel(req, res);
    if (nivel === "master") return next();
    return deny(req, res);
  };
}

module.exports = {
  resolveNivel,
  deny,
  requireAdmin,
  requireMaster,
};
