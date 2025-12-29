// middleware/ensurePermission.js
"use strict";

const { helpers } = require("./ensureAccount");

function normalizeNivel(n) {
  return String(n || "")
    .trim()
    .toLowerCase();
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function isMaster(req) {
  // reaproveita o mesmo padrão do ensureAccount (mas sem depender do middleware ter rodado)
  const nivel = normalizeNivel(req.user?.nivel);
  const role = normalizeNivel(req.user?.role);

  return (
    nivel === "admin_master" ||
    role === "admin_master" ||
    truthy(req.user?.is_master) ||
    truthy(req.user?.isMaster) ||
    truthy(req.user?.flags?.is_master) ||
    req.userContext?.is_master === true
  );
}

function isAdmin(req) {
  // Você pode definir "admin" global (req.user.nivel === 'admin')
  // ou no futuro ligar em papel por empresa. Por enquanto: só global.
  const nivel = normalizeNivel(req.user?.nivel);
  const role = normalizeNivel(req.user?.role);

  return nivel === "admin" || role === "admin";
}

function resolveLevel(req) {
  if (isMaster(req)) return "master";
  if (isAdmin(req)) return "admin";
  return "padrao";
}

function hasLevel(current, required) {
  const rank = { padrao: 1, admin: 2, master: 3 };
  const a = rank[current] || 1;
  const b = rank[required] || 1;
  return a >= b;
}

/**
 * requireLevel("admin" | "master")
 */
function requireLevel(required = "admin") {
  const requiredNorm = normalizeNivel(required) || "admin";

  return function ensurePermission(req, res, next) {
    // Se quiser deixar algumas rotas abertas, você pode checar helpers.isOpen(req) aqui.
    // Mas normalmente autorização é aplicada só onde você usar esse middleware.
    const current = resolveLevel(req);

    if (hasLevel(current, requiredNorm)) return next();

    // comportamento padrão: HTML vai pra view nao autorizado, API 403
    return helpers.deny(req, res, {
      status: 403,
      error: "Não autorizado",
      redirect: "/nao-autorizado",
    });
  };
}

// atalhos
function requireAdmin() {
  return requireLevel("admin");
}
function requireMaster() {
  return requireLevel("master");
}

module.exports = {
  requireLevel,
  requireAdmin,
  requireMaster,
  // expõe caso você queira usar em logs
  resolveLevel,
};
