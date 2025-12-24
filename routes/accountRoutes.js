// routes/accountRoutes.js
"use strict";

const express = require("express");
const db = require("../db/db");

const router = express.Router();

/** Cookies */
const COOKIE_OAUTH = "ml_account_id"; // id da tabela meli_contas
const COOKIE_LEGACY = "ml_account"; // chave legacy (drossi/diplany/rossidecor)

/** (LEGADO) Mapeamento das contas disponíveis via ENV */
const ACCOUNTS = {
  drossi: { label: "DRossi Interiores", envPrefix: "ML_DROSSI" },
  diplany: { label: "Diplany", envPrefix: "ML_DIPLANY" },
  rossidecor: { label: "Rossi Decor", envPrefix: "ML_ROSSIDECOR" },
};

/** Helper: checa se a conta LEGADA tem variáveis mínimas configuradas */
function legacyAccountConfigured(envPrefix) {
  const hasClient =
    !!process.env[`${envPrefix}_APP_ID`] ||
    !!process.env[`${envPrefix}_CLIENT_ID`];
  const hasSecret = !!process.env[`${envPrefix}_CLIENT_SECRET`];
  const hasTokens =
    !!process.env[`${envPrefix}_ACCESS_TOKEN`] ||
    !!process.env[`${envPrefix}_REFRESH_TOKEN`];
  return hasClient && hasSecret && hasTokens;
}

/** Helper: pega empresa do usuário (MVP: 1 usuário -> 1 empresa) */
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

/** Cookie options */
function cookieOptions() {
  const isProd =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 30 * 24 * 3600 * 1000, // 30 dias
    path: "/",
  };
}

/**
 * GET /api/account/list
 * Lista contas OAuth do banco (da empresa do usuário) + contas legacy (opcional)
 */
router.get("/list", async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid))
      return res.status(401).json({ ok: false, error: "Não autenticado." });

    const oauthContas = await db.withClient(async (client) => {
      const emp = await getEmpresaDoUsuario(client, uid);
      if (!emp) return [];

      const r = await client.query(
        `select mc.id,
                mc.meli_user_id,
                mc.apelido,
                mc.site_id,
                mc.status,
                mc.criado_em,
                mc.atualizado_em,
                mc.ultimo_uso_em,
                case when mt.meli_conta_id is null then false else true end as has_tokens
           from meli_contas mc
           left join meli_tokens mt on mt.meli_conta_id = mc.id
          where mc.empresa_id = $1
          order by mc.id desc`,
        [emp.empresa_id]
      );

      return r.rows.map((x) => ({
        type: "oauth",
        id: x.id,
        label: x.apelido || `Conta ${x.meli_user_id}`,
        meli_user_id: x.meli_user_id,
        site_id: x.site_id,
        status: x.status,
        has_tokens: !!x.has_tokens,
      }));
    });

    // (opcional) inclui legacy para compatibilidade enquanto migra
    const legacyContas = Object.entries(ACCOUNTS).map(([key, meta]) => ({
      type: "legacy",
      key,
      label: meta.label,
      configured: legacyAccountConfigured(meta.envPrefix),
    }));

    const currentOAuthId = req.cookies?.[COOKIE_OAUTH]
      ? Number(req.cookies[COOKIE_OAUTH])
      : null;
    const currentLegacy = req.cookies?.[COOKIE_LEGACY] || null;

    // Define "current" preferindo OAuth se existir
    let current = null;
    if (Number.isFinite(currentOAuthId) && currentOAuthId > 0) {
      const found = oauthContas.find((c) => c.id === currentOAuthId) || null;
      current = found
        ? { type: "oauth", id: found.id, label: found.label }
        : { type: "oauth", id: currentOAuthId, label: null };
    } else if (currentLegacy) {
      const label =
        (ACCOUNTS[currentLegacy] && ACCOUNTS[currentLegacy].label) ||
        currentLegacy;
      current = { type: "legacy", key: currentLegacy, label };
    }

    return res.json({
      ok: true,
      oauth: oauthContas,
      legacy: legacyContas,
      current,
    });
  } catch (err) {
    console.error("GET /api/account/list erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar contas" });
  }
});

/**
 * GET /api/account/current
 * Retorna conta atual selecionada (OAuth ou legacy)
 */
router.get("/current", async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid))
      return res.status(401).json({ ok: false, error: "Não autenticado." });

    const oauthId = req.cookies?.[COOKIE_OAUTH]
      ? Number(req.cookies[COOKIE_OAUTH])
      : null;
    const legacyKey = req.cookies?.[COOKIE_LEGACY] || null;

    if (Number.isFinite(oauthId) && oauthId > 0) {
      const info = await db.withClient(async (client) => {
        const emp = await getEmpresaDoUsuario(client, uid);
        if (!emp) return null;

        const r = await client.query(
          `select id, apelido, meli_user_id, status
             from meli_contas
            where id = $1 and empresa_id = $2
            limit 1`,
          [oauthId, emp.empresa_id]
        );
        return r.rows[0] || null;
      });

      if (!info) {
        // cookie inválido
        res.clearCookie(COOKIE_OAUTH, { path: "/" });
        return res.json({ ok: true, current: null });
      }

      return res.json({
        ok: true,
        current: {
          type: "oauth",
          id: info.id,
          label: info.apelido || `Conta ${info.meli_user_id}`,
          meli_user_id: info.meli_user_id,
          status: info.status,
        },
      });
    }

    if (legacyKey && ACCOUNTS[legacyKey]) {
      return res.json({
        ok: true,
        current: {
          type: "legacy",
          key: legacyKey,
          label: ACCOUNTS[legacyKey].label,
        },
      });
    }

    return res.json({ ok: true, current: null });
  } catch (err) {
    console.error("GET /api/account/current erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao obter conta atual" });
  }
});

/**
 * POST /api/account/select
 * - OAuth: { meliContaId }
 * - Legacy: { accountKey }
 */
router.post("/select", express.json({ limit: "200kb" }), async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid))
      return res.status(401).json({ ok: false, error: "Não autenticado." });

    const meliContaId =
      req.body?.meliContaId !== undefined ? Number(req.body.meliContaId) : null;
    const accountKey =
      req.body?.accountKey !== undefined ? String(req.body.accountKey) : null;

    // ===== OAuth select =====
    if (Number.isFinite(meliContaId) && meliContaId > 0) {
      const selected = await db.withClient(async (client) => {
        const emp = await getEmpresaDoUsuario(client, uid);
        if (!emp) return null;

        const r = await client.query(
          `select id, apelido, meli_user_id, status
             from meli_contas
            where id = $1 and empresa_id = $2
            limit 1`,
          [meliContaId, emp.empresa_id]
        );
        return r.rows[0] || null;
      });

      if (!selected)
        return res
          .status(400)
          .json({
            ok: false,
            error: "meliContaId inválido (ou não pertence à sua empresa).",
          });

      // seta cookie OAuth e limpa legado
      res.cookie(COOKIE_OAUTH, String(selected.id), cookieOptions());
      res.clearCookie(COOKIE_LEGACY, { path: "/" });

      return res.json({
        ok: true,
        current: {
          type: "oauth",
          id: selected.id,
          label: selected.apelido || `Conta ${selected.meli_user_id}`,
          meli_user_id: selected.meli_user_id,
          status: selected.status,
        },
      });
    }

    // ===== Legacy select =====
    if (accountKey) {
      if (!ACCOUNTS[accountKey])
        return res
          .status(400)
          .json({ ok: false, error: "accountKey inválido" });

      res.cookie(COOKIE_LEGACY, accountKey, cookieOptions());
      res.clearCookie(COOKIE_OAUTH, { path: "/" });

      return res.json({
        ok: true,
        current: {
          type: "legacy",
          key: accountKey,
          label: ACCOUNTS[accountKey].label,
        },
      });
    }

    return res
      .status(400)
      .json({
        ok: false,
        error: "Envie { meliContaId } (OAuth) ou { accountKey } (legado).",
      });
  } catch (err) {
    console.error("POST /api/account/select erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao selecionar conta" });
  }
});

/**
 * POST /api/account/clear
 * Limpa seleção (OAuth e Legacy)
 */
router.post("/clear", (_req, res) => {
  res.clearCookie(COOKIE_OAUTH, { path: "/" });
  res.clearCookie(COOKIE_LEGACY, { path: "/" });
  return res.json({ ok: true });
});

module.exports = router;
module.exports.ACCOUNTS = ACCOUNTS;
