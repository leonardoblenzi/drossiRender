// routes/accountRoutes.js
"use strict";

const express = require("express");
const db = require("../db/db");

const router = express.Router();

/**
 * Cookie OAuth (id da tabela meli_contas)
 * IMPORTANTE: tem que bater com middleware/ensureAccount.js
 */
const COOKIE_OAUTH = "meli_conta_id";

// ===============================
// Helpers: role
// ===============================
function normalizeNivel(n) {
  return String(n || "")
    .trim()
    .toLowerCase();
}
function isMaster(req) {
  return (
    normalizeNivel(req.user?.nivel) === "admin_master" ||
    req.user?.is_master === true ||
    req.user?.flags?.is_master === true
  );
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

/** Normaliza "current" e devolve formato compatível com o front */
function buildCurrentPayload(cur) {
  if (!cur) {
    return {
      ok: true,
      success: true,
      current: null,
      accountType: null,
      accountKey: null,
      label: null,
    };
  }

  // OAuth-only
  const key = String(cur.id);
  const label =
    String(cur.label || "").trim() || `Conta ${cur.meli_user_id || key}`;

  return {
    ok: true,
    success: true,
    current: { ...cur, label },
    accountType: "oauth",
    accountKey: key,
    label,
  };
}

// ===============================
// ✅ NOVO: GET /api/account/list
// ===============================
/**
 * GET /api/account/list
 * Lista contas disponíveis (OAuth only).
 * - Usuário comum: lista contas da sua empresa
 * - Master: lista global (com empresa no label) — útil para debug/admin
 *
 * Retorna formato compat com seu front:
 * { ok:true, success:true, oauth:[...], legacy:[], current, accountType, accountKey, label }
 */
router.get("/list", async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid)) {
      return res.status(401).json({ ok: false, error: "Não autenticado." });
    }

    const master = isMaster(req);

    const oauthId = req.cookies?.[COOKIE_OAUTH]
      ? Number(req.cookies[COOKIE_OAUTH])
      : null;
    const cookieHasValidId = Number.isFinite(oauthId) && oauthId > 0;

    const data = await db.withClient(async (client) => {
      if (master) {
        const r = await client.query(
          `select mc.id,
                  mc.empresa_id,
                  e.nome as empresa_nome,
                  mc.apelido,
                  mc.meli_user_id,
                  mc.status,
                  mc.site_id,
                  (mt.meli_conta_id is not null) as has_tokens
             from meli_contas mc
             join empresas e on e.id = mc.empresa_id
        left join meli_tokens mt on mt.meli_conta_id = mc.id
         order by e.nome asc, mc.id asc`
        );

        return { empresa: null, contas: r.rows || [] };
      }

      const emp = await getEmpresaDoUsuario(client, uid);
      if (!emp) return { empresa: null, contas: [] };

      const r = await client.query(
        `select mc.id,
                mc.empresa_id,
                $1::text as empresa_nome,
                mc.apelido,
                mc.meli_user_id,
                mc.status,
                mc.site_id,
                (mt.meli_conta_id is not null) as has_tokens
           from meli_contas mc
      left join meli_tokens mt on mt.meli_conta_id = mc.id
          where mc.empresa_id = $2
          order by mc.id asc`,
        [emp.empresa_nome || null, emp.empresa_id]
      );

      return { empresa: emp, contas: r.rows || [] };
    });

    const oauth = (data.contas || []).map((c) => {
      const baseLabel = c.apelido || `Conta ${c.meli_user_id || c.id}`;
      const label =
        master && c.empresa_nome
          ? `${c.empresa_nome} • ${baseLabel}`
          : baseLabel;

      return {
        type: "oauth",
        id: c.id,
        label,
        empresa_id: c.empresa_id,
        empresa_nome: c.empresa_nome || null,
        meli_user_id: c.meli_user_id,
        status: c.status,
        site_id: c.site_id,
        has_tokens: !!c.has_tokens,
      };
    });

    // valida current contra a lista (evita cookie apontando pra conta que não pode)
    let current = null;
    if (cookieHasValidId) {
      current = oauth.find((x) => Number(x.id) === Number(oauthId)) || null;
      if (!current) {
        res.clearCookie(COOKIE_OAUTH, { path: "/" });
      }
    }

    const payloadCurrent = buildCurrentPayload(current);

    return res.json({
      ok: true,
      success: true,
      oauth,
      legacy: [], // (compat) você disse OAuth-only aqui
      ...payloadCurrent,
    });
  } catch (err) {
    console.error("GET /api/account/list erro:", err);
    return res.status(500).json({ ok: false, error: "Erro ao listar contas" });
  }
});

/**
 * GET /api/account/current
 * Retorna a conta atual selecionada (OAuth only).
 * - Para usuário comum: valida que a conta pertence à empresa do usuário
 * - Para master: pode ler qualquer conta selecionada
 */
router.get("/current", async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid)) {
      return res.status(401).json({ ok: false, error: "Não autenticado." });
    }

    const master = isMaster(req);

    const oauthId = req.cookies?.[COOKIE_OAUTH]
      ? Number(req.cookies[COOKIE_OAUTH])
      : null;
    if (!Number.isFinite(oauthId) || oauthId <= 0) {
      return res.json(buildCurrentPayload(null));
    }

    const info = await db.withClient(async (client) => {
      if (master) {
        const r = await client.query(
          `select mc.id,
                  mc.empresa_id,
                  e.nome as empresa_nome,
                  mc.apelido,
                  mc.meli_user_id,
                  mc.status,
                  mc.site_id
             from meli_contas mc
             join empresas e on e.id = mc.empresa_id
            where mc.id = $1
            limit 1`,
          [oauthId]
        );
        return r.rows[0] || null;
      }

      const emp = await getEmpresaDoUsuario(client, uid);
      if (!emp) return null;

      const r = await client.query(
        `select mc.id,
                mc.empresa_id,
                $2::text as empresa_nome,
                mc.apelido,
                mc.meli_user_id,
                mc.status,
                mc.site_id
           from meli_contas mc
          where mc.id = $1 and mc.empresa_id = $3
          limit 1`,
        [oauthId, emp.empresa_nome || null, emp.empresa_id]
      );
      return r.rows[0] || null;
    });

    if (!info) {
      // cookie inválido
      res.clearCookie(COOKIE_OAUTH, { path: "/" });
      return res.json(buildCurrentPayload(null));
    }

    const baseLabel = info.apelido || `Conta ${info.meli_user_id}`;

    // ✅ Master mostra empresa no label (ajuda muito)
    const label =
      master && info.empresa_nome
        ? `${info.empresa_nome} • ${baseLabel}`
        : baseLabel;

    return res.json(
      buildCurrentPayload({
        type: "oauth",
        id: info.id,
        label,
        empresa_id: info.empresa_id,
        empresa_nome: info.empresa_nome,
        meli_user_id: info.meli_user_id,
        status: info.status,
        site_id: info.site_id,
      })
    );
  } catch (err) {
    console.error("GET /api/account/current erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao obter conta atual" });
  }
});

/**
 * POST /api/account/clear
 * Limpa seleção (OAuth only)
 */
router.post("/clear", (_req, res) => {
  res.clearCookie(COOKIE_OAUTH, { path: "/" });
  return res.json({ ok: true, success: true });
});

/**
 * (Opcional) POST /api/account/select
 * Mantido só por compatibilidade: seta o cookie OAuth.
 * Você já tem /api/meli/selecionar — se quiser, pode remover este endpoint depois.
 */
router.post("/select", express.json({ limit: "100kb" }), async (req, res) => {
  try {
    const uid = Number(req.user?.uid);
    if (!Number.isFinite(uid)) {
      return res.status(401).json({ ok: false, error: "Não autenticado." });
    }

    const master = isMaster(req);
    const meliContaId = Number(req.body?.meliContaId);

    if (!Number.isFinite(meliContaId) || meliContaId <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "meliContaId inválido." });
    }

    const selected = await db.withClient(async (client) => {
      if (master) {
        const r = await client.query(
          `select mc.id, mc.apelido, mc.meli_user_id, mc.status, mc.site_id, mc.empresa_id, e.nome as empresa_nome
             from meli_contas mc
             join empresas e on e.id = mc.empresa_id
            where mc.id = $1
            limit 1`,
          [meliContaId]
        );
        return r.rows[0] || null;
      }

      const emp = await getEmpresaDoUsuario(client, uid);
      if (!emp) return null;

      const r = await client.query(
        `select mc.id, mc.apelido, mc.meli_user_id, mc.status, mc.site_id, mc.empresa_id, $2::text as empresa_nome
           from meli_contas mc
          where mc.id = $1 and mc.empresa_id = $3
          limit 1`,
        [meliContaId, emp.empresa_nome || null, emp.empresa_id]
      );
      return r.rows[0] || null;
    });

    if (!selected) {
      return res
        .status(404)
        .json({ ok: false, error: "Conta não encontrada (ou não permitida)." });
    }

    res.cookie(COOKIE_OAUTH, String(selected.id), cookieOptions());

    const baseLabel = selected.apelido || `Conta ${selected.meli_user_id}`;
    const label =
      master && selected.empresa_nome
        ? `${selected.empresa_nome} • ${baseLabel}`
        : baseLabel;

    return res.json(
      buildCurrentPayload({
        type: "oauth",
        id: selected.id,
        label,
        empresa_id: selected.empresa_id,
        empresa_nome: selected.empresa_nome,
        meli_user_id: selected.meli_user_id,
        status: selected.status,
        site_id: selected.site_id,
      })
    );
  } catch (err) {
    console.error("POST /api/account/select erro:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao selecionar conta" });
  }
});

module.exports = router;
