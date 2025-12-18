// routes/analytics-filtro-anuncios-routes.js
// Jobs para Filtro de Anúncios (Export/Paginação)
// Endpoints:
//   POST /api/analytics/filtro-anuncios/jobs            -> cria job
//   GET  /api/analytics/filtro-anuncios/jobs/:job_id    -> status
//   GET  /api/analytics/filtro-anuncios/jobs/:job_id/items -> pagina resultados
//   GET  /api/analytics/filtro-anuncios/jobs/:job_id/download.csv -> baixa CSV
//
// Compat:
//   GET /api/analytics/filtro-anuncios
//     - se vier ?job_id=... -> retorna items do job (SEM LOOP)
//     - se NÃO vier job_id -> cria job e retorna 202 com job_id

'use strict';

const express = require('express');
const router = express.Router();

const filtroQueue = require('../services/filtroAnunciosQueueService');

/* =========================
 * Helpers básicos
 * ========================= */
function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}
function toNum(v, def = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pickAccountKey(req) {
  return (
    req.query.account ||
    (req.cookies && req.cookies.ml_account) ||
    req.headers['x-ml-account'] ||
    null
  );
}

async function resolveAccessToken(req, accountKey) {
  // 1) token já injetado (middleware seu)
  if (req.access_token && typeof req.access_token === 'string') return req.access_token;

  // 2) Authorization: Bearer
  const authHeader = req.headers?.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }

  // 3) Preferência: injeção via app.set('getAccessTokenForAccount', fn)
  const injected = req.app?.get && req.app.get('getAccessTokenForAccount');
  if (typeof injected === 'function') {
    const t = await injected(accountKey, req);
    if (t && typeof t === 'string') return t;
  }

  // 4) fallback (services/ml-auth)
  let mlAuth = null;
  try { mlAuth = require('../services/ml-auth'); } catch (_) {}

  const candidates = [
    mlAuth?.getAccessTokenForAccount,
    mlAuth?.getAccessTokenForAccountKey,
    mlAuth?.getAccessToken,
    mlAuth?.getToken,
  ].filter(Boolean);

  for (const fn of candidates) {
    try {
      const maybe = await fn(accountKey, req);
      if (maybe && typeof maybe === 'string') return maybe;
      if (maybe && typeof maybe === 'object' && maybe.access_token) return maybe.access_token;

      const maybe2 = await fn(accountKey);
      if (maybe2 && typeof maybe2 === 'string') return maybe2;
      if (maybe2 && typeof maybe2 === 'object' && maybe2.access_token) return maybe2.access_token;
    } catch (_) {}
  }

  throw new Error(`Não consegui obter token para a conta "${accountKey}".`);
}

function parseFiltersFromReq(req) {
  // aceita body (POST) ou query (GET)
  const src = (req.body && Object.keys(req.body).length) ? req.body : req.query;

  const date_from = String(src.date_from || '').trim();
  const date_to   = String(src.date_to || '').trim();
  const status    = String(src.status || 'all').trim(); // all|active|paused

  // novos filtros “baratos”
  const envio    = String(src.envio || 'all').trim();       // all | buyer | free
  const tipo     = String(src.tipo || 'all').trim();        // all | classic | premium
  const detalhes = String(src.detalhes || 'all').trim();    // all | catalog | normal

  // filtros por vendas / visitas
  const sales_op = String(src.sales_op || 'all').trim();
  const sales_value = toNum((src.sales_value ?? src.sales_val ?? 0), 0);

  const visits_op = String(src.visits_op || 'all').trim();
  const visits_value = toNum((src.visits_value ?? src.visits_val ?? 0), 0);

  // ordenação (o job usa isso)
  const sort_by = String(src.sort_by || 'sold_value').trim();
  const sort_dir = (String(src.sort_dir || 'desc').toLowerCase() === 'asc') ? 'asc' : 'desc';

  // campo de busca (aplicaremos no endpoint /items, não no job por enquanto)
  const q = String(src.q || '').trim();

  // extras (guardamos no metadata, mesmo que o job ainda não use)
  const promo  = String(src.promo || 'all').trim();
  const ads    = String(src.ads || 'all').trim();
  const clicks_op = String(src.clicks_op || 'all').trim();
  const clicks_value = toNum((src.clicks_value ?? src.clicks_val ?? 0), 0);
  const impr_op = String(src.impr_op || 'all').trim();
  const impr_value = toNum((src.impr_value ?? src.impr_val ?? 0), 0);

  return {
    date_from,
    date_to,
    status,
    envio,
    tipo,
    detalhes,
    sales_op,
    sales_value,
    visits_op,
    visits_value,
    sort_by,
    sort_dir,
    q,

    // guardados/compat
    promo,
    ads,
    clicks_op,
    clicks_value,
    impr_op,
    impr_value,
  };
}

function validateRequiredFilters(filters) {
  if (!filters.date_from || !filters.date_to) {
    const e = new Error('Informe date_from e date_to (YYYY-MM-DD).');
    e.status = 400;
    throw e;
  }
}

function buildEndpoints(jobId) {
  return {
    status_url: `/api/analytics/filtro-anuncios/jobs/${jobId}`,
    items_url: `/api/analytics/filtro-anuncios/jobs/${jobId}/items`,
    download_csv_url: `/api/analytics/filtro-anuncios/jobs/${jobId}/download.csv`,
  };
}

/* =========================
 * CSV helpers
 * ========================= */
function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(rows, fields) {
  const header = fields.join(';');
  const lines = rows.map(r => fields.map(f => csvEscape(r?.[f])).join(';'));
  return [header, ...lines].join('\n');
}

/* =========================================================
 * ✅ Handler reutilizável: itens (paginação + busca)
 *    (isso elimina loop no compat ?job_id=...)
 * ========================================================= */
async function handleJobItems(req, res) {
  try {
    const job_id = String(req.params.job_id || '').trim();
    if (!job_id) return res.status(400).json({ ok: false, error: 'job_id inválido' });

    const page = clamp(toInt(req.query.page, 1), 1, 999999);
    const limit = clamp(toInt(req.query.limit, 50), 10, 200);

    // busca local pós-job
    const q = String(req.query.q || '').trim().toLowerCase();

    // status antes de ler o arquivo
    const st = await filtroQueue.getStatus(job_id);
    if (st.status !== 'concluido') {
      return res.status(202).json({
        ok: true,
        job_id,
        status: st.status,
        progress: st.progress,
        total: st.total ?? null,
        message: 'Job ainda não terminou. Continue consultando o status.',
        endpoints: buildEndpoints(job_id),
      });
    }

    const rows = await filtroQueue.getResults(job_id);

    let filtered = Array.isArray(rows) ? rows : [];

    if (q) {
      filtered = filtered.filter(r =>
        String(r.mlb || '').toLowerCase().includes(q) ||
        String(r.sku || '').toLowerCase().includes(q) ||
        String(r.title || '').toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pageRows = filtered.slice(start, end);

    // Formato “igual sua tela antiga”
    const data = pageRows.map(r => ({
      mlb: r.mlb,
      sku: r.sku,
      nome_anuncio: r.title,
      tipo: r.tipo,
      envios: r.envio,
      detalhes: r.detalhes,
      valor_venda: (r.sold_value_cents || 0) / 100,
      qnt_vendas: r.sales_units || 0,
      impressoes: r.impressions || 0,
      cliques: r.clicks || 0,
      visitas: r.visits || 0,
      promo_ativa: r.promo_active,
      status: r.status || null,
    }));

    return res.json({
      ok: true,
      job_id,
      page,
      limit,
      total,
      data,
      endpoints: buildEndpoints(job_id),
    });
  } catch (err) {
    console.error('handleJobItems erro:', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Erro interno',
    });
  }
}

/* =========================
 * JOBS: criar
 * ========================= */
router.post('/filtro-anuncios/jobs', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const accountKey = pickAccountKey(req);
    if (!accountKey) {
      return res.status(400).json({
        ok: false,
        error: 'Conta não informada. Use cookie ml_account, header x-ml-account ou ?account=....',
      });
    }

    const filters = parseFiltersFromReq(req);
    validateRequiredFilters(filters);

    const token = await resolveAccessToken(req, accountKey);

    // ✅ Enfileira job
    const job_id = await filtroQueue.enqueue({ token, filters });

    return res.status(202).json({
      ok: true,
      account: accountKey,
      job_id,
      message: 'Job criado. Consulte o status e depois pagine os resultados.',
      endpoints: buildEndpoints(job_id),
      filters,
    });
  } catch (err) {
    console.error('POST /api/analytics/filtro-anuncios/jobs erro:', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Erro interno',
      details: {
        url: err.url,
        status: err.status,
        data: err.data,
      },
    });
  }
});

/* =========================
 * JOBS: status
 * ========================= */
router.get('/filtro-anuncios/jobs/:job_id', async (req, res) => {
  try {
    const job_id = String(req.params.job_id || '').trim();
    if (!job_id) return res.status(400).json({ ok: false, error: 'job_id inválido' });

    const st = await filtroQueue.getStatus(job_id);

    return res.json({
      ok: true,
      ...st,
      endpoints: buildEndpoints(job_id),
    });
  } catch (err) {
    console.error('GET /api/analytics/filtro-anuncios/jobs/:job_id erro:', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Erro interno',
    });
  }
});

/* =========================
 * JOBS: itens (paginação + busca)
 * ========================= */
router.get('/filtro-anuncios/jobs/:job_id/items', handleJobItems);

/* =========================
 * JOBS: download CSV
 * ========================= */
router.get('/filtro-anuncios/jobs/:job_id/download.csv', async (req, res) => {
  try {
    const job_id = String(req.params.job_id || '').trim();
    if (!job_id) return res.status(400).json({ ok: false, error: 'job_id inválido' });

    const st = await filtroQueue.getStatus(job_id);
    if (st.status !== 'concluido') {
      return res.status(409).json({
        ok: false,
        error: 'Job ainda não está concluído para download.',
        status: st.status,
        progress: st.progress,
        endpoints: buildEndpoints(job_id),
      });
    }

    const rows = await filtroQueue.getResults(job_id);

    // campos padrão (você pode ajustar depois)
    const fields = String(req.query.fields || 'mlb,sku,title,tipo,envio,detalhes,sales_units,sold_value_cents,visits')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const csv = toCSV(rows, fields);
    const filename = `${job_id}_filtro_anuncios.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('GET /api/analytics/filtro-anuncios/jobs/:job_id/download.csv erro:', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Erro interno',
    });
  }
});

/* =========================
 * COMPAT: GET /filtro-anuncios
 * - sem job_id: cria job e devolve 202
 * - com job_id: devolve items (SEM LOOP)
 * ========================= */
router.get('/filtro-anuncios', async (req, res) => {
  try {
    const job_id = String(req.query.job_id || '').trim();

    // ✅ se tiver job_id: chama handler diretamente (SEM router.handle)
    if (job_id) {
      req.params.job_id = job_id;
      return handleJobItems(req, res);
    }

    const accountKey = pickAccountKey(req);
    if (!accountKey) {
      return res.status(400).json({
        ok: false,
        error: 'Conta não informada. Use cookie ml_account, header x-ml-account ou ?account=....',
      });
    }

    const filters = parseFiltersFromReq(req);
    validateRequiredFilters(filters);

    const token = await resolveAccessToken(req, accountKey);
    const newJobId = await filtroQueue.enqueue({ token, filters });

    return res.status(202).json({
      ok: true,
      account: accountKey,
      job_id: newJobId,
      message: 'Job criado. Consulte o status e depois carregue a página de resultados.',
      endpoints: buildEndpoints(newJobId),
      filters,
    });
  } catch (err) {
    console.error('GET /api/analytics/filtro-anuncios erro:', err);
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Erro interno',
      details: {
        url: err.url,
        status: err.status,
        data: err.data,
      },
    });
  }
});

module.exports = router;
