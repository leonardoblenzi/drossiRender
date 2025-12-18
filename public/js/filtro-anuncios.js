// public/js/filtro-anuncios.js
// =====================================================
// Filtro Avançado de Anúncios — frontend (COM JOBS)
// - NÃO carrega ao abrir (só ao clicar "Filtrar").
// - EXCEÇÃO: se vier ?job_id=... na URL, retoma o job automaticamente.
// - Cria job:  POST /api/analytics/filtro-anuncios/jobs
// - Status:     GET /api/analytics/filtro-anuncios/jobs/:job_id
// - Itens:      GET /api/analytics/filtro-anuncios/jobs/:job_id/items
// - CSV:        GET /api/analytics/filtro-anuncios/jobs/:job_id/download.csv
// =====================================================
(function () {
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // =========================
  // Config
  // =========================
  const API_JOBS_CREATE = '/api/analytics/filtro-anuncios/jobs';
  const API_JOBS_STATUS = (jobId) => `/api/analytics/filtro-anuncios/jobs/${encodeURIComponent(jobId)}`;
  const API_JOBS_ITEMS  = (jobId) => `/api/analytics/filtro-anuncios/jobs/${encodeURIComponent(jobId)}/items`;
  const API_JOBS_CSV    = (jobId) => `/api/analytics/filtro-anuncios/jobs/${encodeURIComponent(jobId)}/download.csv`;

  const TIMEOUT_MS = 60000;

  // Polling do job
  const POLL_MIN_MS = 800;
  const POLL_MAX_MS = 2500;

  // =========================
  // Estado
  // =========================
  const state = {
    hasSearched: false,
    page: 1,
    limit: 50,
    total: 0,
    loading: false,

    // job
    job_id: null,
    job_status: null,
    job_progress: 0,

    // filtros
    date_from: '',
    date_to: '',
    sales_op: 'all',
    sales_value: '',
    status: 'all',
    promo: 'all',
    ads: 'all',
    visits_op: 'all',
    visits_value: '',
    clicks_op: 'all',
    clicks_value: '',
    impr_op: 'all',
    impr_value: '',

    envio: 'all',     // all | buyer | free
    tipo: 'all',      // all | classic | premium
    detalhes: 'all',  // all | catalog | normal

    // ui
    q: '',
    sort_by: 'sold_value',
    sort_dir: 'desc',
    rows: []
  };

  // =========================
  // Helpers
  // =========================
  const fmtMoney = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const fmtInt = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString('pt-BR');
  };

  const safe = (v, fallback = '—') =>
    (v === null || v === undefined || String(v).trim() === '') ? fallback : String(v);

  const debounce = (fn, ms = 250) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchWithTimeout(url, opts = {}) {
    const ctl = new AbortController();
    const timeout = opts.timeout || TIMEOUT_MS;
    const id = setTimeout(() => ctl.abort(), timeout);

    // não repassar "timeout" pro fetch (não é opção nativa)
    const { timeout: _ignored, ...rest } = opts;

    try {
      return await fetch(url, {
        ...rest,
        signal: ctl.signal,
        cache: 'no-store',
        credentials: 'same-origin'
      });
    } finally {
      clearTimeout(id);
    }
  }

  async function readJsonSafe(resp) {
    const txt = await resp.text().catch(() => '');
    if (!txt) return {};
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  }

  function setLoading(on, msg = '') {
    state.loading = !!on;
    const btn = $('#btnPesquisar');
    if (btn) {
      btn.disabled = !!on;
      btn.textContent = on ? (msg || 'Carregando...') : 'Filtrar';
    }
  }

  function setExportLoading(on, msg = '') {
    const btn = $('#btnExportCsv');
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? (msg || 'Exportando...') : 'CSV';
  }

  function updateJobIdInUrl(jobId) {
    try {
      const u = new URL(window.location.href);
      if (jobId) u.searchParams.set('job_id', String(jobId));
      else u.searchParams.delete('job_id');
      window.history.replaceState({}, '', u.toString());
    } catch (_) {}
  }

  function getJobIdFromUrl() {
    try {
      const u = new URL(window.location.href);
      const id = String(u.searchParams.get('job_id') || '').trim();
      return id || null;
    } catch {
      return null;
    }
  }

  function buildFiltersPayload() {
    return {
      date_from: state.date_from,
      date_to: state.date_to,
      status: state.status || 'all',

      sales_op: state.sales_op || 'all',
      sales_value: state.sales_value,

      visits_op: state.visits_op || 'all',
      visits_value: state.visits_value,

      // (guardados mesmo que o job ainda não use tudo)
      promo: state.promo || 'all',
      ads: state.ads || 'all',
      clicks_op: state.clicks_op || 'all',
      clicks_value: state.clicks_value,
      impr_op: state.impr_op || 'all',
      impr_value: state.impr_value,

      // novos filtros
      envio: state.envio || 'all',
      tipo: state.tipo || 'all',
      detalhes: state.detalhes || 'all',

      // ordenação do job
      sort_by: state.sort_by || 'sold_value',
      sort_dir: state.sort_dir || 'desc',

      // OBS: q (busca) fica no /items pra não refazer job
    };
  }

  function qsForItems() {
    const p = new URLSearchParams();
    p.set('page', String(state.page));
    p.set('limit', String(state.limit));
    if (state.q) p.set('q', state.q);
    return p.toString();
  }

  function normalizeStatus(s) {
    const t = String(s || '').toLowerCase().trim();
    if (t === 'concluído') return 'concluido';
    return t;
  }

  // =========================
  // Render tabela
  // =========================
  function renderEmptyPrompt() {
    const tbody = $('#grid tbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:22px; color:#64748b;">
          Clique em <b>Filtrar</b> para carregar os anúncios.
        </td>
      </tr>`;
  }

  function renderLoadingRow(msg) {
    const tbody = $('#grid tbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:22px; color:#64748b;">
          ${msg || 'Carregando...'}
        </td>
      </tr>`;
  }

  function renderTable(rows) {
    const tbody = $('#grid tbody');
    if (!tbody) return;

    if (!state.hasSearched) {
      renderEmptyPrompt();
      return;
    }

    if (!rows || rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:22px; color:#64748b;">
            Nenhum resultado para os filtros selecionados.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r) => {
      const mlb = safe(r.mlb);
      const sku = safe(r.sku);
      const name = safe(r.nome_anuncio || r.title || r.nome);

      const tipo = safe(r.tipo);
      const envios = safe(r.envios);

      const valorVenda = fmtMoney(r.valor_venda);
      const qtdVendas  = fmtInt(r.qnt_vendas);
      const impr       = fmtInt(r.impressoes);
      const clicks     = fmtInt(r.cliques);
      const visits     = fmtInt(r.visitas);

      const clicksVisits = (clicks === '—' && visits === '—')
        ? '—'
        : `${clicks} / ${visits}`;

      return `
        <tr>
          <td title="${mlb}">${mlb}</td>
          <td title="${sku}">${sku}</td>
          <td class="col-title" title="${name}">${name}</td>
          <td>${tipo}</td>
          <td>${envios}</td>
          <td class="num">${valorVenda}</td>
          <td class="num">${qtdVendas}</td>
          <td class="num">${impr}</td>
          <td class="num">${clicksVisits}</td>
        </tr>
      `;
    }).join('');
  }

  // =========================
  // Paginação
  // =========================
  function renderPager() {
    const el = $('#pager');
    if (!el) return;

    if (!state.hasSearched) {
      el.innerHTML = `<div>Mostrando <b>0</b>–<b>0</b> de <b>0</b></div>`;
      return;
    }

    const total = Number(state.total || 0);
    const page = Number(state.page || 1);
    const limit = Number(state.limit || 50);
    const pages = Math.max(1, Math.ceil(total / limit));

    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to   = Math.min(total, page * limit);

    const mkBtn = (label, p, disabled = false, active = false) => {
      const cls = ['pg-btn', disabled ? 'disabled' : '', active ? 'active' : ''].filter(Boolean).join(' ');
      const dis = disabled ? 'disabled' : '';
      return `<button class="${cls}" data-page="${p}" ${dis} type="button">${label}</button>`;
    };

    const windowSize = 7;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(pages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const parts = [];
    parts.push(`<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">`);
    parts.push(`<div>Mostrando <b>${from}</b>–<b>${to}</b> de <b>${total}</b></div>`);
    parts.push(`<div class="paginator">`);
    parts.push(mkBtn('«', 1, page <= 1));
    parts.push(mkBtn('‹', page - 1, page <= 1));

    if (start > 1) {
      parts.push(mkBtn('1', 1, false, page === 1));
      if (start > 2) parts.push(`<span style="padding:0 6px; opacity:.7;">…</span>`);
    }

    for (let p = start; p <= end; p++) parts.push(mkBtn(String(p), p, false, p === page));

    if (end < pages) {
      if (end < pages - 1) parts.push(`<span style="padding:0 6px; opacity:.7;">…</span>`);
      parts.push(mkBtn(String(pages), pages, false, page === pages));
    }

    parts.push(mkBtn('›', page + 1, page >= pages));
    parts.push(mkBtn('»', pages, page >= pages));
    parts.push(`</div></div>`);

    el.innerHTML = parts.join('');

    $$('#pager .pg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        if (!state.hasSearched) return;
        if (b.classList.contains('disabled') || b.classList.contains('active')) return;
        const p = Number(b.dataset.page || 1);
        if (!Number.isFinite(p) || p < 1) return;
        state.page = p;
        loadItemsPage().catch(console.error);
      });
    });
  }

  // =========================
  // JOB flow
  // =========================
  async function createJob() {
    if (!state.date_from || !state.date_to) {
      alert('⚠️ Informe Período: de / até.');
      return null;
    }

    const payload = buildFiltersPayload();

    const r = await fetchWithTimeout(API_JOBS_CREATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: TIMEOUT_MS
    });

    const data = await readJsonSafe(r);

    if (!r.ok || data.ok === false) {
      const msg = (data && (data.message || data.error)) || `HTTP ${r.status}`;
      throw new Error(msg);
    }

    const jobId = data.job_id || data.id;
    if (!jobId) throw new Error('API não retornou job_id.');
    return String(jobId);
  }

  async function pollJobUntilDone(jobId) {
    let wait = POLL_MIN_MS;

    while (true) {
      const r = await fetchWithTimeout(API_JOBS_STATUS(jobId), { timeout: TIMEOUT_MS });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || data.ok === false) {
        const msg = (data && (data.message || data.error)) || `HTTP ${r.status}`;
        throw new Error(msg);
      }

      const status = normalizeStatus(data.status);
      const progress = Number(data.progress ?? 0);

      state.job_status = status;
      state.job_progress = Number.isFinite(progress) ? progress : 0;

      const pct = Math.max(0, Math.min(100, Math.round(state.job_progress)));
      setLoading(true, `Processando... ${pct}%`);
      renderLoadingRow(`Processando... <b>${pct}%</b> (pode demorar em contas grandes)`);

      if (status === 'concluido') return true;
      if (status === 'erro' || status === 'failed' || status === 'falhou') {
        throw new Error(data.error || 'Job falhou.');
      }

      await sleep(wait);
      wait = Math.min(POLL_MAX_MS, Math.round(wait * 1.35));
    }
  }

  async function loadItemsPage() {
    if (!state.job_id) return;

    setLoading(true, 'Carregando...');

    try {
      const url = `${API_JOBS_ITEMS(state.job_id)}?${qsForItems()}`;
      const r = await fetchWithTimeout(url, { timeout: TIMEOUT_MS });
      const data = await r.json().catch(() => ({}));

      // enquanto roda, backend pode responder 202
      if (r.status === 202) {
        await pollJobUntilDone(state.job_id);
        return await loadItemsPage();
      }

      if (!r.ok || data.ok === false) {
        const msg = (data && (data.message || data.error)) || `HTTP ${r.status}`;
        throw new Error(msg);
      }

      state.hasSearched = true;
      state.total = Number(data.total ?? 0);
      state.rows = Array.isArray(data.data) ? data.data : [];

      renderTable(state.rows);
      renderPager();
    } catch (e) {
      console.error('loadItemsPage:', e);

      state.hasSearched = true;
      state.total = 0;
      state.rows = [];
      renderTable([]);
      renderPager();

      const msg = String(e?.name || '').toLowerCase().includes('abort')
        ? 'Timeout ao carregar dados. Tente reduzir o período e/ou filtrar Status.'
        : ('❌ Erro ao carregar dados: ' + (e.message || e));

      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // Ação principal: Filtrar
  // =========================
  async function runFilterFlow() {
    if (state.loading) return;

    setLoading(true, 'Criando job...');
    renderLoadingRow('Criando job...');

    try {
      // cria job novo
      const jobId = await createJob();
      if (!jobId) return;

      state.job_id = jobId;
      updateJobIdInUrl(jobId);

      state.page = 1;
      state.hasSearched = true;

      await pollJobUntilDone(jobId);
      await loadItemsPage();
    } catch (e) {
      console.error('runFilterFlow:', e);

      state.hasSearched = true;
      state.total = 0;
      state.rows = [];
      renderTable([]);
      renderPager();

      alert('❌ Erro: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // Export CSV (server-side)
  // =========================
  async function exportCsvFromServer() {
    if (state.loading) return;

    if (!state.job_id) {
      alert('⚠️ Clique em "Filtrar" antes de exportar.');
      return;
    }

    setExportLoading(true, 'Preparando...');

    try {
      const st = await fetchWithTimeout(API_JOBS_STATUS(state.job_id), { timeout: TIMEOUT_MS });
      const stData = await st.json().catch(() => ({}));
      if (!st.ok || stData.ok === false) throw new Error(stData.error || `HTTP ${st.status}`);

      const status = normalizeStatus(stData.status);
      if (status !== 'concluido') {
        await pollJobUntilDone(state.job_id);
      }

      // download direto do backend
      const url = API_JOBS_CSV(state.job_id);
      window.location.href = url;
    } catch (e) {
      console.error('exportCsvFromServer:', e);
      alert('❌ Erro ao exportar CSV: ' + (e.message || e));
    } finally {
      setExportLoading(false);
    }
  }

  // =========================
  // Conta / Status / Trocar Conta
  // =========================
  const ACCOUNT_LABELS = {
    drossi: 'DRossi Interiores',
    diplany: 'Diplany',
    rossidecor: 'Rossi Decor'
  };

  async function carregarContaAtual() {
    const currentEl = $('#account-current');
    try {
      const r = await fetch('/api/account/current', { cache: 'no-store' });
      const data = await r.json();

      let shown = 'Não selecionada';
      if (data && (data.ok || data.success)) {
        shown = data.label || ACCOUNT_LABELS[data.accountKey] || data.accountKey || 'Desconhecida';
      }
      if (currentEl) currentEl.textContent = shown;
    } catch (e) {
      if (currentEl) currentEl.textContent = 'Indisponível';
      console.error('carregarContaAtual:', e);
    }
  }

  async function trocarConta() {
    try { await fetch('/api/account/clear', { method: 'POST' }); } catch (_) {}
    updateJobIdInUrl(null);
    window.location.href = '/select-conta';
  }

  function abrirStatusRapido() {
    window.location.href = '/dashboard#status';
  }

  // =========================
  // Bind UI -> state
  // =========================
  function bindFilters() {
    const bind = (id, key) => {
      const el = $('#' + id);
      if (!el) return;

      const isInput = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
      if (!isInput) return;

      const ev = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
      el.addEventListener(ev, () => {
        state[key] = el.value;
      });
    };

    bind('fDateFrom', 'date_from');
    bind('fDateTo', 'date_to');

    bind('fSalesOp', 'sales_op');
    bind('fSalesVal', 'sales_value');

    bind('fStatus', 'status');
    bind('fPromo', 'promo');
    bind('fAds', 'ads');

    bind('fVisitsOp', 'visits_op');
    bind('fVisitsVal', 'visits_value');

    bind('fClicksOp', 'clicks_op');
    bind('fClicksVal', 'clicks_value');

    bind('fImprOp', 'impr_op');
    bind('fImprVal', 'impr_value');

    // novos filtros
    bind('fEnvio', 'envio');
    bind('fTipo', 'tipo');
    bind('fDetalhes', 'detalhes');

    // busca: só faz reload automático se já pesquisou pelo menos 1x
    const search = $('#fSearch');
    if (search) {
      search.addEventListener('input', debounce(() => {
        state.q = search.value.trim();
        if (!state.hasSearched || !state.job_id) return;
        state.page = 1;
        loadItemsPage().catch(console.error);
      }, 350));
    }

    const btn = $('#btnPesquisar');
    if (btn) {
      btn.addEventListener('click', () => {
        state.page = 1;
        runFilterFlow().catch(console.error);
      });
    }

    const btnCsv = $('#btnExportCsv');
    if (btnCsv) btnCsv.addEventListener('click', exportCsvFromServer);

    const btnStatus = $('#btn-status');
    if (btnStatus) btnStatus.addEventListener('click', abrirStatusRapido);

    const btnSwitch = $('#account-switch');
    if (btnSwitch) btnSwitch.addEventListener('click', trocarConta);
  }

  function setDefaultDates() {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 29);

    const iso = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const fFrom = $('#fDateFrom');
    const fTo = $('#fDateTo');

    if (fFrom && !fFrom.value) fFrom.value = iso(from);
    if (fTo && !fTo.value) fTo.value = iso(to);

    state.date_from = fFrom ? fFrom.value : iso(from);
    state.date_to = fTo ? fTo.value : iso(to);
  }

  async function resumeJobIfPresent() {
    const jobFromUrl = getJobIdFromUrl();
    if (!jobFromUrl) return;

    state.job_id = jobFromUrl;
    state.page = 1;
    state.hasSearched = true;

    setLoading(true, 'Retomando job...');
    renderLoadingRow('Retomando job pela URL...');

    try {
      await pollJobUntilDone(jobFromUrl);
      await loadItemsPage();
    } catch (e) {
      console.error('resumeJobIfPresent:', e);
      alert('⚠️ Não consegui retomar o job: ' + (e.message || e));
      // se falhar, limpa a URL pra não ficar preso nisso
      updateJobIdInUrl(null);
      state.job_id = null;
      state.hasSearched = false;
      state.total = 0;
      state.rows = [];
      renderTable([]);
      renderPager();
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // Boot
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    setDefaultDates();
    bindFilters();
    carregarContaAtual();

    // NÃO carrega dados aqui por padrão.
    state.hasSearched = false;
    state.total = 0;
    state.rows = [];
    renderTable([]);
    renderPager();

    // ✅ Se veio ?job_id=... na URL, retoma automaticamente
    resumeJobIfPresent().catch(console.error);
  });
})();
