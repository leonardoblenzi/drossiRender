// routes/meliOAuthRoutes.js
"use strict";

const express = require("express");
const crypto = require("crypto");
const db = require("../db/db");

const router = express.Router();

// ===============================
// Config do seu App (Mercado Livre)
// ===============================
const ML_APP_ID =
  process.env.ML_APP_ID || process.env.APP_ID || process.env.CLIENT_ID;

const ML_CLIENT_SECRET =
  process.env.ML_CLIENT_SECRET || process.env.CLIENT_SECRET;

const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI || process.env.REDIRECT_URI;

if (!ML_APP_ID) {
  console.warn("⚠️ ML_APP_ID não definido (ML_APP_ID / APP_ID / CLIENT_ID).");
}
if (!ML_CLIENT_SECRET) {
  console.warn(
    "⚠️ ML_CLIENT_SECRET não definido (ML_CLIENT_SECRET / CLIENT_SECRET)."
  );
}
if (!ML_REDIRECT_URI) {
  console.warn(
    "⚠️ ML_REDIRECT_URI não definido (ML_REDIRECT_URI / REDIRECT_URI)."
  );
}

// Brasil (ajuste se precisar multi-país)
const AUTH_BASE = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const ML_USERS_URL = "https://api.mercadolibre.com/users";

// Cookie da conta selecionada (novo padrão)
const COOKIE_MELI_CONTA = "meli_conta_id";

// Em produção (Render), você está com trust proxy = 1, então secure funciona
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 3600 * 1000, // 30 dias
    path: "/",
  };
}

// ===============================
// Helpers PKCE + state
// ===============================
function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(str) {
  const hash = crypto.createHash("sha256").update(str).digest();
  return base64Url(hash);
}

function randomState() {
  return base64Url(crypto.randomBytes(24));
}

function randomVerifier() {
  // 64 bytes -> ~86 chars base64url
  return base64Url(crypto.randomBytes(64));
}

// Evita open redirect: só aceita path interno do seu app
function sanitizeReturnTo(input) {
  let rt = String(input || "/vincular-conta").trim() || "/vincular-conta";
  // precisa começar com "/" e não pode começar com "//"
  if (!rt.startsWith("/") || rt.startsWith("//")) rt = "/vincular-conta";
  return rt;
}

async function getEmpresaDoUsuario(client, usuarioId) {
  // MVP: assume 1 usuário -> 1 empresa (owner/admin/operador)
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

// (Opcional) busca nickname no ML para usar como apelido default
async function tryGetMlNickname(accessToken, meliUserId) {
  try {
    if (!accessToken || !meliUserId) return null;
    const resp = await fetch(`${ML_USERS_URL}/${meliUserId}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const nick = String(data?.nickname || "").trim();
    return nick || null;
  } catch {
    return null;
  }
}

function mustBeLogged(req) {
  const uid = Number(req.user?.uid);
  return Number.isFinite(uid) ? uid : null;
}

function readCurrentContaId(req) {
  const raw = req.cookies?.[COOKIE_MELI_CONTA];
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

// ===============================
// GET /api/meli/contas
// Lista contas vinculadas da empresa do usuário logado
// Retorna também current_meli_conta_id (cookie httpOnly)
// ===============================
router.get("/contas", async (req, res) => {
  try {
    const uid = mustBeLogged(req);
    if (!uid)
      return res.status(401).json({ ok: false, error: "Não autenticado." });

    const currentId = readCurrentContaId(req);

    const rows = await db.withClient(async (client) => {
      const emp = await getEmpresaDoUsuario(client, uid);
      if (!emp)
        throw new Error("Usuário não está vinculado a nenhuma empresa.");

      const r = await client.query(
        `select id, meli_user_id, apelido, site_id, status, criado_em, atualizado_em, ultimo_uso_em
           from meli_contas
          where empresa_id = $1
          order by id desc`,
        [emp.empresa_id]
      );
      return r.rows;
    });

    // Se o cookie aponta pra uma conta que não existe mais, derruba (higiene)
    if (currentId && !rows.some((c) => Number(c.id) === Number(currentId))) {
      res.clearCookie(COOKIE_MELI_CONTA, { path: "/" });
      return res.json({ ok: true, contas: rows, current_meli_conta_id: null });
    }

    return res.json({
      ok: true,
      contas: rows,
      current_meli_conta_id: currentId,
    });
  } catch (e) {
    console.error("GET /api/meli/contas erro:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: "Erro ao listar contas vinculadas." });
  }
});

// ===============================
// POST /api/meli/selecionar
// body: { meli_conta_id }
// Seta cookie httpOnly meli_conta_id (sessão atual)
// ===============================
router.post(
  "/selecionar",
  express.json({ limit: "50kb" }),
  async (req, res) => {
    try {
      const uid = mustBeLogged(req);
      if (!uid)
        return res.status(401).json({ ok: false, error: "Não autenticado." });

      const meli_conta_id = Number(req.body?.meli_conta_id);
      if (!Number.isFinite(meli_conta_id)) {
        return res
          .status(400)
          .json({ ok: false, error: "meli_conta_id inválido." });
      }

      // garante que a conta pertence à empresa do usuário
      const ok = await db.withClient(async (client) => {
        const emp = await getEmpresaDoUsuario(client, uid);
        if (!emp)
          throw new Error("Usuário não está vinculado a nenhuma empresa.");

        const r = await client.query(
          `select c.id
           from meli_contas c
          where c.id = $1 and c.empresa_id = $2
          limit 1`,
          [meli_conta_id, emp.empresa_id]
        );
        return !!r.rows[0];
      });

      if (!ok) {
        return res
          .status(404)
          .json({ ok: false, error: "Conta não encontrada para sua empresa." });
      }

      res.cookie(COOKIE_MELI_CONTA, String(meli_conta_id), cookieOptions());
      return res.json({ ok: true, meli_conta_id });
    } catch (e) {
      console.error("POST /api/meli/selecionar erro:", e?.message || e);
      return res
        .status(500)
        .json({ ok: false, error: "Erro ao selecionar conta." });
    }
  }
);

// ===============================
// POST /api/meli/limpar-selecao
// Limpa cookie meli_conta_id
// ===============================
router.post("/limpar-selecao", async (_req, res) => {
  res.clearCookie(COOKIE_MELI_CONTA, { path: "/" });
  return res.json({ ok: true });
});

// ===============================
// POST /api/meli/oauth/start
// body: { return_to? }
// ===============================
router.post(
  "/oauth/start",
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      // falha cedo se faltar config completa
      if (!ML_APP_ID || !ML_CLIENT_SECRET || !ML_REDIRECT_URI) {
        return res.status(500).json({
          ok: false,
          error:
            "Config do Mercado Livre incompleta (APP_ID/SECRET/REDIRECT_URI).",
        });
      }

      const uid = mustBeLogged(req);
      if (!uid)
        return res.status(401).json({ ok: false, error: "Não autenticado." });

      const return_to = sanitizeReturnTo(
        req.body?.return_to || "/vincular-conta"
      );

      const state = randomState();
      const code_verifier = randomVerifier();
      const code_challenge = sha256Base64Url(code_verifier);

      const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await db.withClient(async (client) => {
        await client.query("begin");
        try {
          const empresa = await getEmpresaDoUsuario(client, uid);
          if (!empresa)
            throw new Error("Usuário não está vinculado a nenhuma empresa.");

          // higiene: limpa states expirados
          await client.query(
            `delete from oauth_states where expira_em < now()`
          );

          await client.query(
            `insert into oauth_states (state, empresa_id, usuario_id, code_verifier, return_to, expira_em)
           values ($1, $2, $3, $4, $5, $6)`,
            [
              state,
              empresa.empresa_id,
              uid,
              code_verifier,
              return_to,
              expiraEm.toISOString(),
            ]
          );

          await client.query("commit");
        } catch (e) {
          await client.query("rollback");
          throw e;
        }
      });

      const url = new URL(AUTH_BASE);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", String(ML_APP_ID));
      url.searchParams.set("redirect_uri", String(ML_REDIRECT_URI));
      url.searchParams.set("state", state);

      // PKCE
      url.searchParams.set("code_challenge", code_challenge);
      url.searchParams.set("code_challenge_method", "S256");

      return res.json({ ok: true, url: url.toString() });
    } catch (err) {
      console.error("POST /api/meli/oauth/start erro:", err?.message || err);
      return res
        .status(500)
        .json({ ok: false, error: "Erro ao iniciar vinculação." });
    }
  }
);

// ===============================
// GET /api/meli/oauth/callback?code=...&state=...
// ===============================
router.get("/oauth/callback", async (req, res) => {
  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();

  if (!code || !state) {
    return res.status(400).send("Callback inválido: faltou code ou state.");
  }

  try {
    if (!ML_APP_ID || !ML_CLIENT_SECRET || !ML_REDIRECT_URI) {
      return res
        .status(500)
        .send(
          "Config do Mercado Livre incompleta (APP_ID/SECRET/REDIRECT_URI)."
        );
    }

    const outcome = await db.withClient(async (client) => {
      await client.query("begin");
      try {
        // pega state
        const st = await client.query(
          `select state, empresa_id, usuario_id, code_verifier, return_to, expira_em
             from oauth_states
            where state = $1
            limit 1`,
          [state]
        );

        const row = st.rows[0];
        if (!row)
          throw new Error("state não encontrado (expirou ou já foi usado).");
        if (new Date(row.expira_em).getTime() < Date.now())
          throw new Error("state expirado.");

        // troca code por token
        const body = new URLSearchParams();
        body.set("grant_type", "authorization_code");
        body.set("client_id", String(ML_APP_ID));
        body.set("client_secret", String(ML_CLIENT_SECRET));
        body.set("code", code);
        body.set("redirect_uri", String(ML_REDIRECT_URI));
        body.set("code_verifier", String(row.code_verifier));

        const resp = await fetch(TOKEN_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        });

        const data = await resp.json().catch(() => null);

        if (
          !resp.ok ||
          !data?.access_token ||
          !data?.refresh_token ||
          !data?.user_id
        ) {
          const msg =
            data?.error_description ||
            data?.message ||
            "Falha ao trocar code por token.";
          throw new Error(msg);
        }

        const meli_user_id = Number(data.user_id);
        const access_token = String(data.access_token);
        const refresh_token = String(data.refresh_token);
        const scope = String(data.scope || "").trim() || null;

        // expiração absoluta
        const expiresInSec = Number(data.expires_in || 0);
        const access_expires_at = new Date(
          Date.now() + Math.max(60, expiresInSec) * 1000
        );

        // 1) upsert meli_contas (por empresa + meli_user_id)
        let contaId = null;

        const existing = await client.query(
          `select id, apelido, status
             from meli_contas
            where empresa_id = $1 and meli_user_id = $2
            limit 1`,
          [row.empresa_id, meli_user_id]
        );

        if (existing.rows[0]) {
          contaId = existing.rows[0].id;

          await client.query(
            `update meli_contas
                set status = 'ativa',
                    atualizado_em = now(),
                    ultimo_uso_em = now()
              where id = $1`,
            [contaId]
          );
        } else {
          // tenta nickname do ML p/ apelido padrão
          let apelido = await tryGetMlNickname(access_token, meli_user_id);
          if (!apelido) apelido = `Conta ${meli_user_id}`;

          const ins = await client.query(
            `insert into meli_contas (empresa_id, meli_user_id, apelido, site_id, status)
             values ($1, $2, $3, 'MLB', 'ativa')
             returning id`,
            [row.empresa_id, meli_user_id, apelido]
          );

          contaId = ins.rows[0].id;
        }

        // 2) upsert tokens (1:1 por meli_conta_id)
        await client.query(
          `insert into meli_tokens
            (meli_conta_id, access_token, access_expires_at, refresh_token, scope, refresh_obtido_em, ultimo_refresh_em)
           values ($1, $2, $3, $4, $5, now(), now())
           on conflict (meli_conta_id)
           do update set
              access_token = excluded.access_token,
              access_expires_at = excluded.access_expires_at,
              refresh_token = excluded.refresh_token,
              scope = excluded.scope,
              ultimo_refresh_em = now()`,
          [
            contaId,
            access_token,
            access_expires_at.toISOString(),
            refresh_token,
            scope,
          ]
        );

        // state é 1x uso
        await client.query(`delete from oauth_states where state = $1`, [
          state,
        ]);

        await client.query("commit");

        return {
          return_to: row.return_to || "/vincular-conta",
          meli_user_id,
          contaId,
        };
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    });

    // ✅ (opcional mas MUITO útil): já seleciona a conta recém vinculada
    // Assim, se você quiser depois redirecionar para /select-conta, ela já aparece como "selecionada".
    try {
      if (outcome?.contaId) {
        res.cookie(COOKIE_MELI_CONTA, String(outcome.contaId), cookieOptions());
      }
    } catch (_) {}

    // sucesso -> volta para a tela (somente path interno)
    const go = sanitizeReturnTo(outcome.return_to || "/vincular-conta");
    return res.redirect(go);
  } catch (err) {
    const pgCode = String(err?.code || "");
    if (pgCode === "23505") {
      const constraint = String(err?.constraint || "");

      // índices atuais:
      // ux_meli_contas_empresa_apelido
      // ux_meli_contas_empresa_meli_user
      if (constraint.includes("ux_meli_contas_empresa_apelido")) {
        return res
          .status(409)
          .send("Já existe uma conta com esse apelido nesta empresa.");
      }

      if (constraint.includes("ux_meli_contas_empresa_meli_user")) {
        return res
          .status(409)
          .send("Essa conta do Mercado Livre já está vinculada nesta empresa.");
      }

      // se existir unique global no futuro, cairia aqui também
      if (
        constraint.toLowerCase().includes("global") ||
        constraint.toLowerCase().includes("meli_user")
      ) {
        return res
          .status(409)
          .send(
            "Essa conta do Mercado Livre já está vinculada a outra empresa neste sistema."
          );
      }

      return res
        .status(409)
        .send("Conflito ao salvar vinculação (registro duplicado).");
    }

    console.error("GET /api/meli/oauth/callback erro:", err?.message || err);
    return res
      .status(500)
      .send(`Erro ao vincular conta: ${err?.message || "erro desconhecido"}`);
  }
});

module.exports = router;
