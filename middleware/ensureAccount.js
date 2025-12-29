// middleware/ensureAccount.js
// Garante que uma conta foi selecionada e injeta credenciais em res.locals.mlCreds
// Suporta (NOVO):
//  - OAuth: cookie "meli_conta_id" (id de meli_contas) -> busca tokens no banco
//
// Mantém o modo LEGADO comentado no final (cookie "ml_account" -> .env)

"use strict";

const db = require("../db/db");

// ====== Cookie (NOVO padrão) ======
const COOKIE_OAUTH = "meli_conta_id"; // ✅ OAuth

// ====== Rotas abertas (não exigem conta selecionada) ======
const OPEN_PREFIXES = [
  // home / públicos
  "/api/account",
  "/",
  "/selecao-plataforma",
  "/login",
  "/cadastro",
  "/nao-autorizado",

  // auth do app
  "/api/auth",

  // seleção/vinculação (podem abrir sem conta selecionada)
  "/select-conta",
  "/vincular-conta",

  // OAuth ML (start/callback/contas/selecionar/limpar)
  "/api/meli",

  // system/health/debug
  "/api/system/health",
  "/api/system/stats",
  "/api/health",
  "/health",
  "/test-basic",
  "/debug/routes",

  // estáticos
  "/favicon.ico",
  "/robots.txt",
  "/public",
  "/css",
  "/js",
  "/img",
  "/assets",
  "/_next",
  "/static",
];

const SKIP_METHODS = new Set(["OPTIONS", "HEAD"]);

function getReqPath(req) {
  // req.path é o melhor para comparar prefixos (sem querystring)
  return req.path || req.originalUrl || "";
}

function isOpen(req) {
  if (SKIP_METHODS.has(req.method)) return true;
  const p = getReqPath(req);
  return OPEN_PREFIXES.some((base) => p === base || p.startsWith(base + "/"));
}

function isApi(req) {
  const p = getReqPath(req);
  return p.startsWith("/api/");
}

function wantsHtml(req) {
  // IMPORTANTE:
  // fetch() geralmente manda Accept "*/*" -> isso NÃO deve ser tratado como HTML.
  if (isApi(req)) return false;

  const accept = String(req.headers?.accept || "").toLowerCase();
  if (!accept) return false;

  if (accept.includes("text/html") || accept.includes("application/xhtml+xml"))
    return true;

  return false;
}

function deny(
  req,
  res,
  { status = 401, error = "Acesso negado", redirect = "/select-conta" } = {}
) {
  if (wantsHtml(req) && req.method === "GET") return res.redirect(redirect);
  return res.status(status).json({ ok: false, error, redirect });
}

function clearOAuthCookie(res) {
  res.clearCookie(COOKIE_OAUTH, { path: "/" });
}

// ===============================
// Helpers: uid / role (ROBUSTO)
// ===============================
function getUid(req) {
  // cobre formatos comuns do ensureAuth
  const raw =
    req.user?.uid ??
    req.user?.id ??
    req.user?.user_id ??
    req.user?.usuario_id ??
    null;

  const uid = Number(raw);
  return Number.isFinite(uid) ? uid : null;
}

function normalizeNivel(n) {
  return String(n || "").trim().toLowerCase();
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function isMaster(req) {
  // cobre formatos comuns:
  // - req.user.is_master
  // - req.user.flags.is_master (bem comum)
  // - req.user.isMaster
  // - req.user.nivel === admin_master
  // - req.user.role === admin_master
  const nivel = normalizeNivel(req.user?.nivel);
  const role  = normalizeNivel(req.user?.role);

  return (
    nivel === "admin_master" ||
    role === "admin_master" ||
    truthy(req.user?.is_master) ||
    truthy(req.user?.isMaster) ||
    truthy(req.user?.flags?.is_master)
  );
}

// ====== Helpers OAuth (banco) ======
async function getEmpresaDoUsuario(client, usuarioId) {
  const r = await client.query(
    `select eu.empresa_id, eu.papel, e.nome as empresa_nome
       from empresa_usuarios eu
       join empresas e on e.id = eu.empresa_id
      where eu.usuario_id = $1
      order by case eu.papel when 'owner' then 1 when 'admin' then 2 else 3 end
      limit 1`,
    [usuarioId]
  );
  return r.rows[0] || null;
}

/**
 * Usuário comum/admin: valida que a conta pertence à empresa do usuário.
 */
async function getOAuthCredsForUserAndContaId(usuarioId, meliContaId) {
  return db.withClient(async (client) => {
    const emp = await getEmpresaDoUsuario(client, usuarioId);
    if (!emp) return null;

    const c = await client.query(
      `select mc.id,
              mc.empresa_id,
              mc.meli_user_id,
              mc.apelido,
              mc.site_id,
              mc.status
         from meli_contas mc
        where mc.id = $1 and mc.empresa_id = $2
        limit 1`,
      [meliContaId, emp.empresa_id]
    );

    const conta = c.rows[0];
    if (!conta) return null;

    const t = await client.query(
      `select mt.access_token,
              mt.access_expires_at,
              mt.refresh_token,
              mt.scope,
              mt.refresh_obtido_em,
              mt.ultimo_refresh_em
         from meli_tokens mt
        where mt.meli_conta_id = $1
        limit 1`,
      [conta.id]
    );

    const tok = t.rows[0] || null;

    return {
      conta,
      tokens: tok,
      empresa_id: emp.empresa_id,
      empresa_nome: emp.empresa_nome,
    };
  });
}

/**
 * ✅ Admin master: pode usar qualquer conta existente.
 * Retorna empresa_nome da conta selecionada (pra UI/header).
 */
async function getOAuthCredsForMasterAndContaId(meliContaId) {
  return db.withClient(async (client) => {
    const c = await client.query(
      `select mc.id,
              mc.empresa_id,
              e.nome as empresa_nome,
              mc.meli_user_id,
              mc.apelido,
              mc.site_id,
              mc.status
         from meli_contas mc
         join empresas e on e.id = mc.empresa_id
        where mc.id = $1
        limit 1`,
      [meliContaId]
    );

    const conta = c.rows[0];
    if (!conta) return null;

    const t = await client.query(
      `select mt.access_token,
              mt.access_expires_at,
              mt.refresh_token,
              mt.scope,
              mt.refresh_obtido_em,
              mt.ultimo_refresh_em
         from meli_tokens mt
        where mt.meli_conta_id = $1
        limit 1`,
      [conta.id]
    );

    const tok = t.rows[0] || null;

    return {
      conta: {
        id: conta.id,
        empresa_id: conta.empresa_id,
        meli_user_id: conta.meli_user_id,
        apelido: conta.apelido,
        site_id: conta.site_id,
        status: conta.status,
      },
      tokens: tok,
      empresa_id: conta.empresa_id,
      empresa_nome: conta.empresa_nome,
    };
  });
}

function ensureCredsBag(res) {
  if (!res.locals) res.locals = {};
  if (!res.locals.mlCreds) res.locals.mlCreds = {};
  return res.locals.mlCreds;
}

/**
 * ensureAccount
 */
async function ensureAccount(req, res, next) {
  if (isOpen(req)) return next();

  // 0) precisa estar autenticado no app (ensureAuth antes)
  const uid = getUid(req);
  if (!uid) {
    return deny(req, res, {
      status: 401,
      error: "Não autenticado",
      redirect: "/login",
    });
  }

  const master = isMaster(req);

  // 1) cookie OAuth (meli_conta_id)
  const raw = req.cookies?.[COOKIE_OAUTH];
  const meliContaId = raw ? Number(raw) : null;

  if (!Number.isFinite(meliContaId) || meliContaId <= 0) {
    return deny(req, res, {
      status: 401,
      error: "Conta não selecionada",
      redirect: "/select-conta",
    });
  }

  try {
    const pack = master
      ? await getOAuthCredsForMasterAndContaId(meliContaId)
      : await getOAuthCredsForUserAndContaId(uid, meliContaId);

    if (!pack) {
      // Se chegou aqui:
      // - master: conta não existe
      // - não-master: conta não pertence à empresa OU usuário sem empresa
      // Evita "apagar cookie" em cascata sem diagnóstico — mas mantemos a limpeza por segurança.
      clearOAuthCookie(res);

      return deny(req, res, {
        status: 401,
        error: master
          ? "Conta selecionada não encontrada."
          : "Conta não selecionada",
        redirect: "/select-conta",
      });
    }

    // Identidade da conta para UI/log
    res.locals.accountMode = "oauth";
    res.locals.accountKey = String(pack.conta.id);
    res.locals.accountLabel =
      pack.conta.apelido || `Conta ${pack.conta.meli_user_id}`;

    res.locals.account = {
      mode: "oauth",
      key: String(pack.conta.id),
      label: res.locals.accountLabel,
      meli_user_id: pack.conta.meli_user_id,
      site_id: pack.conta.site_id || "MLB",
      status: pack.conta.status,
      // ajuda a UI master
      empresa_id: pack.empresa_id,
      empresa_nome: pack.empresa_nome,
    };

    res.locals.empresaId = pack.empresa_id;
    res.locals.empresaNome = pack.empresa_nome;

    const creds = ensureCredsBag(res);

    creds.app_id =
      process.env.ML_APP_ID ||
      process.env.APP_ID ||
      process.env.CLIENT_ID ||
      null;

    creds.client_secret =
      process.env.ML_CLIENT_SECRET || process.env.CLIENT_SECRET || null;

    creds.redirect_uri =
      process.env.ML_REDIRECT_URI || process.env.REDIRECT_URI || null;

    creds.account_key = String(pack.conta.id);
    creds.meli_conta_id = pack.conta.id;
    creds.meli_user_id = pack.conta.meli_user_id;
    creds.site_id = pack.conta.site_id || "MLB";
    creds.status = pack.conta.status;

    if (pack.tokens) {
      creds.access_token = pack.tokens.access_token || null;
      creds.refresh_token = pack.tokens.refresh_token || null;
      creds.access_expires_at = pack.tokens.access_expires_at || null;
      creds.scope = pack.tokens.scope || null;
    } else {
      creds.access_token = null;
      creds.refresh_token = null;
      creds.access_expires_at = null;
      creds.scope = null;
    }

    // Compat (legado)
    if (creds.access_token) process.env.ACCESS_TOKEN = String(creds.access_token);
    if (creds.app_id) process.env.APP_ID = String(creds.app_id);
    if (creds.client_secret) process.env.CLIENT_SECRET = String(creds.client_secret);
    if (creds.refresh_token) process.env.REFRESH_TOKEN = String(creds.refresh_token);
    if (creds.redirect_uri) process.env.REDIRECT_URI = String(creds.redirect_uri);

    return next();
  } catch (e) {
    console.error("❌ ensureAccount (oauth) erro:", e?.message || e);
    return deny(req, res, {
      status: 500,
      error: "Erro ao carregar conta OAuth",
      redirect: "/select-conta",
    });
  }
}

module.exports = ensureAccount;
