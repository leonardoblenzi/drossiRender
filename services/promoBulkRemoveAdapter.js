// services/promoBulkRemoveAdapter.js
// Fila mínima em memória para REMOÇÃO de promoções.
// Expõe:
//   - startRemoveJob({ mlbIds, delayMs, mlCreds, accountKey, logger })
//   - listRecent(limit)
//   - jobDetail(id)
//   - removeOne({ mlCreds, promotion_id, promotion_type, item_id })

const fetch = require('node-fetch');

const JOBS = new Map(); // id -> { id, title, state, progress, created_at, updated_at, total, ok, err, account }
const TTL_MS = 24 * 60 * 60 * 1000;
const SELF_BASE = process.env.SELF_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

function nowISO() { return new Date().toISOString(); }

function gc() {
  const t = Date.now();
  for (const [id, j] of JOBS) {
    const ref = new Date(j.updated_at || j.created_at || Date.now()).getTime();
    if ((t - ref) > TTL_MS) JOBS.delete(id);
  }
}

function shapeForList(j) {
  return {
    id: j.id,
    title: j.title || 'Remoção',
    state: j.state || '',
    progress: j.progress || 0,
    created_at: j.created_at,
    updated_at: j.updated_at,
    // para o painel mostrar a pill da conta
    account: j.account || (j.account_key ? { key: j.account_key } : null),
  };
}

function listRecent(limit = 15) {
  gc();
  return [...JOBS.values()]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit)
    .map(shapeForList);
}

function jobDetail(id) {
  const j = JOBS.get(String(id));
  return j ? { ...j, account: j.account || (j.account_key ? { key: j.account_key } : null) } : null;
}

/**
 * Remove um único item via rota legada do seu backend.
 * Ajuste o path se necessário.
 */
async function removeOneViaLegacy({ mlb, promotion_id, promotion_type }) {
  const url = `${SELF_BASE}/anuncio/remover-promocao`;
  const body = { mlb_id: mlb };
  // Se sua rota aceitar, envia também contexto da campanha:
  if (promotion_id)   body.promotion_id = String(promotion_id);
  if (promotion_type) body.promotion_type = String(promotion_type);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }

  // Considera sucesso quando { success: true }
  return { ok: r.ok && !!json?.success, status: r.status, body: json };
}

/**
 * API consumida pelo PromoJobsService quando action === 'remove'
 * Mantemos assinatura compatível:
 *   removeOne({ mlCreds, promotion_id, promotion_type, item_id })
 */
async function removeOne({ mlCreds, promotion_id, promotion_type, item_id }) {
  try {
    const res = await removeOneViaLegacy({
      mlb: item_id,
      promotion_id,
      promotion_type,
    });
    return {
      ok: !!res.ok,
      status: res.status ?? (res.ok ? 200 : 400),
      body: res.body ?? null,
    };
  } catch (e) {
    return { ok: false, status: 500, error: e?.message || String(e) };
  }
}

/**
 * Inicia um job simples em memória para remover vários itens sequencialmente.
 */
async function startRemoveJob({ mlbIds = [], delayMs = 250, mlCreds = {}, accountKey = null, logger = console }) {
  if (!Array.isArray(mlbIds) || !mlbIds.length) {
    throw new Error('Nenhum MLB informado.');
  }

  const id = `job_rm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const job = {
    id,
    kind: 'remove',
    title: `Remoção – ${mlbIds.length} itens`,
    state: 'iniciando…',
    progress: 0,
    total: mlbIds.length,
    ok: 0,
    err: 0,
    items: mlbIds.slice(0, 3), // amostra para debug/UI
    account_key: accountKey || null,
    account: accountKey ? { key: accountKey } : null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  JOBS.set(id, job);

  // Processa em background
  (async () => {
    try {
      let done = 0;
      for (const mlb of mlbIds) {
        job.state = `removendo ${done + 1}/${job.total}…`;
        job.updated_at = nowISO();
        JOBS.set(id, job);

        try {
          const res = await removeOneViaLegacy({ mlb });
          if (res.ok) job.ok++;
          else job.err++;
        } catch (e) {
          job.err++;
          logger?.warn?.('[promoBulkRemoveAdapter] erro remover', mlb, e?.message || e);
        }

        done++;
        job.progress = Math.round((done / job.total) * 100);
        job.updated_at = nowISO();
        JOBS.set(id, job);

        if (delayMs > 0 && done < job.total) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
      job.state = `concluído: ${job.ok} ok, ${job.err} erros`;
      job.progress = 100;
      job.updated_at = nowISO();
      JOBS.set(id, job);
    } catch (e) {
      job.state = `erro: ${e?.message || e}`;
      job.progress = 100;
      job.updated_at = nowISO();
      JOBS.set(id, job);
    }
  })();

  return job;
}

module.exports = {
  startRemoveJob,
  listRecent,
  jobDetail,
  removeOne, // <— necessário para o PromoJobsService (action "remove")
};
