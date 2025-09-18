// public/js/ia-analytics-curva-abc.js
// UI da página Curva ABC (tempo real via API do ML)

(() => {
  console.log('🚀 Curva ABC • ML tempo real');

  const qs  = (s, el=document) => el.querySelector(s);
  const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));
  const $   = (id) => document.getElementById(id);

  const fmtMoneyCents = (c) =>
    (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = (x) =>
    `${(Number(x || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const asArray = (sel) => Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);

  // =========================================================
  // PROGRESS UI (barra lateral)
  // =========================================================
  function ensureProgressPanel() {
    // Se já existe um painel custom no seu HTML/CSS, use ele:
    let panel = $('reportProgressPanel');
    if (panel) return panel;

    // fallback: cria um painel básico
    panel = document.createElement('div');
    panel.id = 'reportProgressPanel';
    panel.style.cssText = `
      position: fixed; right: 16px; top: 80px; width: 320px; z-index: 10000;
      background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.12);
      border: 1px solid #eee; display:none; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    `;
    panel.innerHTML = `
      <div style="padding:14px 16px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between">
        <strong>Processando relatório</strong>
        <button type="button" id="rpClose" style="border:none;background:#f6f6f6;border-radius:8px;padding:6px 10px;cursor:pointer">Fechar</button>
      </div>
      <div style="padding:16px">
        <div id="rpTitle" style="font-size:13px;color:#666">Iniciando…</div>
        <div style="height:8px;background:#f3f3f3;border-radius:999px;margin:10px 0 6px 0;overflow:hidden">
          <div id="rpBar" style="height:100%;width:0;background:#4f46e5;transition:width .25s ease"></div>
        </div>
        <div id="rpPct" style="font-size:12px;color:#666">0%</div>
        <div id="rpLog" style="margin-top:10px;max-height:180px;overflow:auto;font-size:12px;color:#444"></div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#rpClose').addEventListener('click', () => hideProgress());
    return panel;
  }

  function showProgress(title) {
    const p = ensureProgressPanel();
    p.style.display = 'block';
    qs('#rpTitle', p).textContent = title || 'Processando…';
    qs('#rpBar', p).style.width = '0%';
    qs('#rpPct', p).textContent = '0%';
    qs('#rpLog', p).innerHTML = '';
  }
  function hideProgress() {
    const p = $('reportProgressPanel');
    if (p) p.style.display = 'none';
  }
  function logProgress(msg, type='info') {
    const p = $('reportProgressPanel'); if (!p) return;
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.margin = '4px 0';
    el.style.color = type === 'error' ? '#b42318' : type === 'warn' ? '#8a6d3b' : '#444';
    qs('#rpLog', p).appendChild(el);
    qs('#rpLog', p).scrollTop = qs('#rpLog', p).scrollHeight;
  }
  function updateProgress(pct) {
    const p = $('reportProgressPanel'); if (!p) return;
    const clamped = Math.max(0, Math.min(100, pct));
    qs('#rpBar', p).style.width = clamped + '%';
    qs('#rpPct', p).textContent = clamped.toFixed(0) + '%';
  }

  // =========================================================
  // Helpers
  // =========================================================
  // fetch com timeout (polyfill robusto)
  async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      return r;
    } finally {
      clearTimeout(id);
    }
  }

  // 🔵 Badge "ADS: Status"
  function adsBadgeHTML(statusCode, statusText, hasActivity) {
    const cls =
      statusCode === 'active' ? 'ads-yes' :
      statusCode === 'paused' ? 'ads-paused' :
      'ads-no';
    const hint =
      statusCode === 'active'
        ? (hasActivity ? 'Em campanha (com atividade no período)' : 'Em campanha (sem atividade no período)')
        : statusCode === 'paused'
          ? 'Em campanha (pausado no período)'
          : (hasActivity ? 'Sem campanha (houve atividade registrada — verifique atribuição)' : 'Sem campanha no período');
    return `<span class="ads-badge ${cls}" title="${hint}"><span class="dot"></span>${statusText}</span>`;
  }

  const state = {
    curveTab: 'ALL',
    loading: false,
    groupBy: 'mlb',
    metric: 'revenue',
    aCut: 0.75,
    bCut: 0.92,
    minUnits: 1,
    limit: 20,
    page: 1,
    sort: null,
    lastItems: [],
    totals: null,
    curveCards: null
  };

  // ===== Topbar
  async function initTopBar() {
    try {
      const r = await fetch('/api/account/current', { cache: 'no-store' });
      const j = await r.json();
      const shown = j.label || j.accountKey || '—';
      const el = $('account-current');
      if (el) el.textContent = shown;
    } catch {}
    const btnSwitch = $('account-switch');
    if (btnSwitch) btnSwitch.addEventListener('click', async () => {
      try { await fetch('/api/account/clear', { method: 'POST' }); } catch {}
      location.href = '/select-conta';
    });
    const btnStatus = $('btn-status');
    if (btnStatus) btnStatus.addEventListener('click', async () => {
      try {
        const r = await fetch('/verificar-token');
        const d = await r.json();
        alert(d.success
          ? `✅ ${d.message}\nUser: ${d.nickname}\nToken: ${d.token_preview}`
          : `❌ ${d.error || 'Falha ao verificar'}`);
      } catch (e) { alert('❌ ' + e.message); }
    });
  }

  // Datas padrão (30 dias)
  function setDefaultDates() {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - 29);
    $('fDateFrom').value = from.toISOString().slice(0, 10);
    $('fDateTo').value   = to.toISOString().slice(0, 10);
  }

  // Contas
  async function loadAccounts() {
    const sel = $('fAccounts'); sel.innerHTML = '';
    try {
      const r = await fetch('/api/account/list', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const arr = j?.accounts || j || [];
      arr.forEach(acc => {
        const id = acc.id || acc.account || acc.key || acc.alias || acc.codigo || String(acc);
        const nm = acc.name || acc.label || acc.nome || acc.display || id;
        const op = document.createElement('option');
        op.value = id; op.textContent = nm;
        sel.appendChild(op);
      });
      if (sel.options.length) sel.options[0].selected = true;
    } catch {
      const cookieAcc = (document.cookie.match(/(?:^|;\s*)ml_account=([^;]+)/) || [])[1] || 'default';
      const op = document.createElement('option');
      op.value = cookieAcc; op.textContent = cookieAcc;
      sel.appendChild(op); sel.options[0].selected = true;
    }
  }

  // Filtros
  function getFilters(extra = {}) {
    const base = {
      date_from: $('fDateFrom').value,
      date_to:   $('fDateTo').value,
      accounts:  asArray($('fAccounts')).join(','),
      full:      $('fFull').value || 'all',
      metric:    state.metric,
      group_by:  state.groupBy,
      a_cut:     state.aCut,
      b_cut:     state.bCut,
      min_units: 1,
      limit:     state.limit,
      page:      state.page
    };
    if (state.sort) base.sort = state.sort;
    return Object.assign(base, extra);
  }

  // Loading overlay
  function setLoading(on) {
    state.loading = on;
    let overlay = qs('#abcLoading');
    if (on) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'abcLoading';
        overlay.style.cssText = `
          position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
          background:rgba(0,0,0,.08);backdrop-filter:saturate(80%) blur(0px);z-index:9999;
          font:500 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        `;
        overlay.innerHTML = `<div class="card" style="padding:18px 20px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.08)">
          Carregando Curva ABC…</div>`;
        document.body.appendChild(overlay);
      }
    } else {
      overlay?.remove();
    }
  }

  // ===== Cards pequenos (A/B/C/Total)
  function renderMiniCards() {
    const cc = state.curveCards || {};
    const T  = state.totals || {};

    const fill = (pref, data) => {
      if (!data) return;
      const units   = Number(data.units || data.units_total || 0);
      const revCts  = Number(data.revenue_cents || data.revenue_cents_total || 0);
      const items   = Number(data.items_count ?? data.count_items ?? 0);
      const ticket  = Number(data.ticket_avg_cents ?? (units > 0 ? Math.round(revCts / units) : 0));
      const rShare  = Number(data.revenue_share ?? data.share ?? 0);

      $(`k${pref}_units`).textContent  = units.toLocaleString('pt-BR');
      $(`k${pref}_value`).textContent  = fmtMoneyCents(revCts);
      $(`k${pref}_items`).textContent  = items.toLocaleString('pt-BR');
      $(`k${pref}_ticket`).textContent = fmtMoneyCents(ticket);
      $(`k${pref}_share`).textContent  = fmtPct(rShare);
    };

    fill('A', cc.A); fill('B', cc.B); fill('C', cc.C);

    const tUnits  = Number(T.units_total || 0);
    const tRev    = Number(T.revenue_cents_total || 0);
    $('kT_units').textContent  = tUnits.toLocaleString('pt-BR');
    $('kT_value').textContent  = fmtMoneyCents(tRev);
    $('kT_items').textContent  = Number(T.items_total || 0).toLocaleString('pt-BR');
    $('kT_ticket').textContent = fmtMoneyCents(tUnits > 0 ? Math.round(tRev / tUnits) : 0);
  }

  // Meta dos cards (texto sob o título)
  function renderCardsMeta(curves) {
    const safe = (obj) => obj || { share: 0, count_items: 0 };
    const A = safe(curves?.A), B = safe(curves?.B), C = safe(curves?.C);
    $('cardAmeta').textContent = `${(A.share * 100).toFixed(1)}% • ${A.count_items} itens`;
    $('cardBmeta').textContent = `${(B.share * 100).toFixed(1)}% • ${B.count_items} itens`;
    $('cardCmeta').textContent = `${(C.share * 100).toFixed(1)}% • ${C.count_items} itens`;
  }

  // Top 5
  function fillUL(id, arr) {
    const ul = $(id);
    ul.innerHTML = '';
    (arr || []).forEach(i => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="muted">${i.mlb || ''}${i.sku ? ' • ' + i.sku : ''}</span>
        <span><b>${i.units || 0}</b> • ${fmtMoneyCents(i.revenue_cents || 0)}</span>
      `;
      ul.appendChild(li);
    });
  }

  // Summary
  async function loadSummary() {
    setLoading(true);
    try {
      const params = new URLSearchParams(getFilters()).toString();
      const r = await fetch(`/api/analytics/abc-ml/summary?${params}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`summary HTTP ${r.status}`);
      const j = await r.json();

      state.totals = j.totals || null;
      state.curveCards = j.curve_cards || null;

      renderMiniCards();
      renderCardsMeta(j.curves);
      fillUL('listA', j.top5?.A);
      fillUL('listB', j.top5?.B);
      fillUL('listC', j.top5?.C);
    } catch (e) {
      console.error(e);
      alert('❌ Falha ao carregar resumo da Curva ABC.');
    } finally {
      setLoading(false);
    }
  }

  // Seleção visual
  function setSelection(tag) {
    qsa('.cards .card').forEach(c => c.classList.remove('selected'));
    if (tag === 'TOTAL') {
      const t = $('cardTotal');
      t && t.classList.add('selected');
    } else if (tag === 'A' || tag === 'B' || tag === 'C') {
      const el = qs(`.cards .card[data-curve="${tag}"]`);
      el && el.classList.add('selected');
    }
  }

  // ===== Renderização da Tabela
 // Substitua sua função renderTable por esta:
function renderTable(rows, page, total, limit) {
  state.lastItems = Array.isArray(rows) ? rows : [];
  state.page = page;

  const tb = qs('#grid tbody');
  tb.innerHTML = '';

  const T = state.totals || {};
  const uTotal = Number(T.units_total || 0);
  const rTotal = Number(T.revenue_cents_total || 0);

  (state.lastItems).forEach((r, idx) => {
    try {
      const curve = r.curve || '-';
      const pillClass = curve ? `idx-${curve}` : '';

      const unitShare = typeof r.unit_share === 'number' ? r.unit_share : (uTotal > 0 ? (r.units || 0) / uTotal : 0);
      const revShare  = typeof r.revenue_share === 'number' ? r.revenue_share : (rTotal > 0 ? (r.revenue_cents || 0) / rTotal : 0);

      const promoActive = !!(r.promo && r.promo.active);
      const promoPct = (r.promo && r.promo.percent != null) ? Number(r.promo.percent) : null;
      const promoTxt = promoActive ? 'Sim' : 'Não';
      const promoPctTxt = (promoActive && promoPct != null) ? fmtPct(promoPct) : '—';

      const ads = r.ads || {};
      const statusCode = ads.status_code || (ads.in_campaign ? 'active' : 'none');
      const statusText = ads.status_text || (ads.in_campaign ? 'Ativo' : 'Não');
      const clicks = Number(ads.clicks || 0);
      const imps   = Number(ads.impressions || 0);
      const spendC = Number(ads.spend_cents || 0);
      const aRevC  = Number(ads.revenue_cents || 0);
      const hasActivity = !!ads.had_activity || (clicks + imps + spendC + aRevC) > 0;
      const acosVal = aRevC > 0 ? (spendC / aRevC) : null;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="idx-pill ${pillClass}">${curve}</span></td>
        <td>${r.mlb || ''}</td>
        <td>${r.title || ''}</td>
        <td>${(r.units || 0).toLocaleString('pt-BR')}</td>
        <td class="percent">${fmtPct(unitShare)}</td>
        <td class="num">${fmtMoneyCents(r.revenue_cents || 0)}</td>
        <td class="percent">${fmtPct(revShare)}</td>
        <td>${promoTxt}</td>
        <td class="percent">${promoPctTxt}</td>
        <td>${adsBadgeHTML(statusCode, statusText, hasActivity)}</td>
        <td class="num">${clicks.toLocaleString('pt-BR')}</td>
        <td class="num">${imps.toLocaleString('pt-BR')}</td>
        <td class="num">${fmtMoneyCents(spendC)}</td>
        <td class="percent">${hasActivity && acosVal !== null ? fmtPct(acosVal) : '—'}</td>
        <td class="num">${fmtMoneyCents(aRevC)}</td>
      `;
      tb.appendChild(tr);
    } catch (rowErr) {
      console.error('Falha ao renderizar linha', idx, rowErr, r);
      // não aborta toda a tabela — só pula a linha com problema
    }
  });

  renderPagination(page, total, limit);
}

// Substitua sua função loadItems por esta:
async function loadItems(curve = state.curveTab || 'ALL', page = 1) {
  setLoading(true);
  try {
    state.curveTab = curve;
    state.page = page;

    if (curve === 'ALL' && state.sort === 'share') {
      setSelection('TOTAL');
    } else if (curve === 'ALL') {
      qsa('.cards .card').forEach(c => c.classList.remove('selected'));
    } else {
      setSelection(curve);
    }

    const base = getFilters({ curve, page, limit: state.limit, include_ads: '1' });
    const s = $('fSearch').value?.trim();
    if (s) base.search = s;

    const params = new URLSearchParams(base).toString();
    const url = `/api/analytics/abc-ml/items?${params}`;

    // usa o mesmo timeout robusto do export (evita “signal timed out”)
    const resp = await fetchWithTimeout(url, { credentials: 'same-origin' }, 90000);
    if (!resp.ok) {
      throw new Error(`items HTTP ${resp.status}`);
    }
    const j = await resp.json();

    if (!j || !Array.isArray(j.data)) {
      console.warn('Resposta inesperada de /items', j);
      renderTable([], j?.page || page, j?.total || 0, j?.limit || state.limit);
      return;
    }

    let rows = j.data.slice();

    // ordenações consistentes
    if (state.sort === 'share') {
      const T = state.totals || {};
      const rTotal = Number(T.revenue_cents_total || 0);
      rows = rows
        .map(it => {
          const share = (typeof it.revenue_share === 'number')
            ? it.revenue_share
            : (rTotal > 0 ? (it.revenue_cents || 0) / rTotal : 0);
          return { ...it, __share__: share };
        })
        .sort((a, b) => b.__share__ - a.__share__);
    } else if (state.metric === 'revenue') {
      rows.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
    } else {
      rows.sort((a, b) => (b.units || 0) - (a.units || 0));
    }

    renderTable(rows, j.page || page, j.total ?? rows.length, j.limit || state.limit);
  } catch (e) {
    console.error(e);
    // se o painel de progresso estiver aberto, loga lá também
    const p = document.getElementById('reportProgressPanel');
    if (p && p.style.display !== 'none') {
      const log = document.createElement('div');
      log.textContent = 'Erro ao carregar itens: ' + (e?.message || e);
      log.style.color = '#b42318';
      log.style.margin = '4px 0';
      p.querySelector('#rpLog')?.appendChild(log);
    }
    alert('❌ Falha ao carregar itens da Curva ABC: ' + (e?.message || e));
    // evita deixar a tabela “congelada”
    renderTable([], page, 0, state.limit);
  } finally {
    setLoading(false);
  }
}


  // ===== Paginador
  function renderPagination(page, total, limit) {
    const pager = $('pager');
    const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 20)));

    const mkBtn = (p, label = null, disabled = false, active = false) => {
      const b = document.createElement('button');
      b.className = 'pg-btn' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      b.textContent = label || String(p);
      b.disabled = !!disabled;
      if (!disabled && !active) b.addEventListener('click', () => goToPage(p));
      return b;
    };

    pager.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'paginator';

    wrap.appendChild(mkBtn(Math.max(1, page-1), '«', page <= 1));
    for (let p = 1; p <= totalPages; p++) {
      wrap.appendChild(mkBtn(p, String(p), false, p === page));
    }
    wrap.appendChild(mkBtn(Math.min(totalPages, page+1), '»', page >= totalPages));

    pager.appendChild(wrap);
  }

  function goToPage(p) {
    const curve = state.curveTab || 'ALL';
    loadItems(curve, p);
  }

  // ===== Busca paginada (com progresso + retry + fallback sem ADS)
  async function fetchAllPages(onProgress, opts = {}) {
    const {
      limit = 150,         // menos itens/página = respostas mais rápidas/estáveis
      withAds = true,
      timeoutMs = 90000,   // 90s — evita "signal timed out" em lotes grandes
      maxRetries = 3
    } = opts;

    const fetchItemsPage = async (page, tryWithAds) => {
      const base = getFilters({
        curve: state.curveTab || 'ALL',
        page,
        limit,
        include_ads: tryWithAds ? '1' : '0'
      });
      const params = new URLSearchParams(base).toString();
      const url = `/api/analytics/abc-ml/items?${params}`;

      let lastErr;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const r = await fetchWithTimeout(url, { credentials: 'same-origin' }, timeoutMs);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return await r.json();
        } catch (e) {
          lastErr = e;
          await new Promise(res => setTimeout(res, 400 * attempt)); // backoff
        }
      }
      throw lastErr || new Error('Falha ao buscar página');
    };

    let page = 1, all = [], totalPages = 1;

    do {
      try {
        const j = await fetchItemsPage(page, withAds);
        all = all.concat(j.data || []);
        totalPages = Math.max(1, Math.ceil((j.total || 0) / (j.limit || limit)));
        typeof onProgress === 'function' && onProgress({ page, totalPages, withAds: true });
        page++;
      } catch (e1) {
        logProgress(`Página ${page}: timeout/erro com ADS — tentando sem ADS…`, 'warn');
        try {
          const j2 = await fetchItemsPage(page, false);
          all = all.concat(j2.data || []);
          totalPages = Math.max(1, Math.ceil((j2.total || 0) / (j2.limit || limit)));
          typeof onProgress === 'function' && onProgress({ page, totalPages, withAds: false });
          page++;
        } catch (e2) {
          throw new Error(`Falha ao buscar a página ${page}: ${(e2 && e2.message) || e2}`);
        }
      }
    } while (page <= totalPages);

    return all;
  }

 // ===== Export CSV (com FAB de progresso no canto)
async function exportCSV() {
  try {
    setLoading(true);
    progressFab.show('Carregando dados para exportação…');

    const allRows = await fetchAllPages(); // sua função atual

    progressFab.message('Gerando CSV…');

    const rowsForCsv = allRows.slice();
    if (state.sort === 'share' || state.metric === 'revenue') {
      rowsForCsv.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
    } else {
      rowsForCsv.sort((a, b) => (b.units || 0) - (a.units || 0));
    }

    const uTotal = rowsForCsv.reduce((s, r) => s + (r.units || 0), 0);
    const rTotal = rowsForCsv.reduce((s, r) => s + (r.revenue_cents || 0), 0);

    const head = [
      'Índice','MLB','Título',
      'Unidades','Unid. (%)','Valor','FATURAMENTO %',
      'PROMO','% APLICADA',
      'ADS','Cliques','Impr.','Invest.','ACOS','Receita Ads',
      'Vendas 7D','Vendas 15D','Vendas 30D','Vendas 40D','Vendas 60D','Vendas 90D'
    ];

    const rows = rowsForCsv.map(r => {
      const unitShare = uTotal > 0 ? (r.units || 0) / uTotal : 0;
      const revShare  = rTotal > 0 ? (r.revenue_cents || 0) / rTotal : 0;

      const promoActive = !!(r.promo && r.promo.active);
      const promoTxt = promoActive ? 'Sim' : 'Não';
      const promoPct = (r.promo && r.promo.percent != null) ? Number(r.promo.percent) : null;
      const promoPctCsv = (promoActive && promoPct != null)
        ? (promoPct * 100).toFixed(2).replace('.', ',') + '%'
        : '—';

      const ads = r.ads || {};
      const clicks = Number(ads.clicks || 0);
      const imps   = Number(ads.impressions || 0);
      const spendC = Number(ads.spend_cents || 0);
      const aRevC  = Number(ads.revenue_cents || 0);
      const acosVal = aRevC > 0 ? (spendC / aRevC) : null;
      const statusText = ads.status_text || (ads.in_campaign ? 'Ativo' : 'Não');

      return [
        r.curve || '-',
        r.mlb || '',
        (r.title || '').replace(/"/g, '""'),

        (r.units || 0),
        (unitShare * 100).toFixed(2).replace('.', ',') + '%',
        (Number(r.revenue_cents || 0) / 100).toFixed(2).replace('.', ','),
        (revShare * 100).toFixed(2).replace('.', ',') + '%',

        promoTxt,
        promoPctCsv,

        statusText,
        clicks,
        imps,
        (spendC / 100).toFixed(2).replace('.', ','),
        acosVal !== null ? (acosVal * 100).toFixed(2).replace('.', ',') + '%' : '—',
        (aRevC / 100).toFixed(2).replace('.', ','),

        Number(r.units_7d  || 0),
        Number(r.units_15d || 0),
        Number(r.units_30d || 0),
        Number(r.units_40d || 0),
        Number(r.units_60d || 0),
        Number(r.units_90d || 0)
      ];
    });

    const data = [head, ...rows]
      .map(cols => cols.map(c => `"${String(c)}"`).join(';'))
      .join('\r\n');

    const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'curva_abc.csv';
    a.click();
    URL.revokeObjectURL(url);

    progressFab.message('Concluído!');
    progressFab.done(true);
  } catch (e) {
    console.error(e);
    progressFab.message('Falha: ' + (e?.message || e));
    progressFab.done(false);
    alert('❌ Falha ao exportar CSV: ' + (e?.message || e));
  } finally {
    setLoading(false);
  }
}


  // ===== Bind
  function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function applySwitchDefaults(){
    qsa('#switch-groupby .btn-switch').forEach(b => b.classList.toggle('active', b.dataset.group === state.groupBy));
    qsa('#switch-metric  .btn-switch').forEach(b => b.classList.toggle('active', b.dataset.metric === state.metric));
  }

  function renderAccountChips() {
    const sel = $('fAccounts');
    const box = $('accChips');
    if (!sel || !box) return;
    const opts = Array.from(sel.selectedOptions);
    if (!opts.length) { box.innerHTML = ''; return; }
    box.innerHTML = opts.map(o => `<span class="chip">${o.textContent}</span>`).join('');
  }

  function bind() {
    $('btnPesquisar').addEventListener('click', () => { state.page = 1; loadSummary(); loadItems('ALL', 1); });

    qsa('.cards .card[data-curve]').forEach(el => {
      el.addEventListener('click', () => {
        const curve = el.getAttribute('data-curve') || 'ALL';
        state.sort = null;
        state.page = 1;
        loadItems(curve, 1);
      });
    });

    const totalCard = $('cardTotal');
    if (totalCard) {
      totalCard.addEventListener('click', () => {
        $('fSearch').value = '';
        state.sort = 'share';
        state.page = 1;
        loadItems('ALL', 1);
      });
    }

    qsa('#switch-groupby .btn-switch').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('#switch-groupby .btn-switch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.groupBy = btn.dataset.group; state.page = 1;
        loadSummary(); loadItems(state.curveTab || 'ALL', 1);
      });
    });
    qsa('#switch-metric .btn-switch').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('#switch-metric .btn-switch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.metric = btn.dataset.metric; state.page = 1;
        loadSummary(); loadItems(state.curveTab || 'ALL', 1);
      });
    });

    $('fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.page = 1; loadItems('ALL', 1); } });
    $('fSearch').addEventListener('input', debounce(() => { state.page = 1; loadItems(state.curveTab || 'ALL', 1); }, 500));

    $('fFull').addEventListener('change', () => { state.page = 1; loadSummary(); loadItems(state.curveTab || 'ALL', 1); });

    const btnCsv = $('btnExportCsv');
    if (btnCsv) btnCsv.addEventListener('click', exportCSV);
  }

  // === FAB de progresso (canto inferior direito) ===
const progressFab = (() => {
  let root, icon, msgEl;

  function ensure() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'reportFab';
    root.innerHTML = `
      <div class="rf-row">
        <span id="rfIcon" class="rf-spinner"></span>
        <div style="display:flex;flex-direction:column;gap:2px">
          <div class="rf-title">Processando relatório</div>
          <div id="rfMsg" class="rf-msg">Preparando…</div>
        </div>
        <button id="rfClose" class="rf-close" title="Fechar" type="button">×</button>
      </div>
    `;
    document.body.appendChild(root);
    icon  = root.querySelector('#rfIcon');
    msgEl = root.querySelector('#rfMsg');
    root.querySelector('#rfClose').onclick = hide;
    return root;
  }

  function show(message = 'Processando…') {
    ensure();
    root.style.display = 'block';
    icon.className = 'rf-spinner';
    msgEl.textContent = message;
  }

  function message(m) {
    ensure();
    msgEl.textContent = m;
  }

  function done(ok = true) {
    ensure();
    icon.className = ok ? 'rf-check' : 'rf-check err';
    // some de leve em 2.2s
    setTimeout(hide, 2200);
  }

  function hide() {
    if (root) root.style.display = 'none';
  }

  return { show, message, done, hide };
})();


  // ===== Boot
  window.addEventListener('DOMContentLoaded', async () => {
    await initTopBar();
    setDefaultDates();
    await loadAccounts();
    renderAccountChips();
    applySwitchDefaults();
    bind();
    $('fAccounts').addEventListener('change', renderAccountChips);
    await loadSummary();
    await loadItems('ALL', 1);
  });
})();
