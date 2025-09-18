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

  // 🔵 Badge visual "ADS: Status"
  function adsBadgeHTML(statusCode, statusText, hasActivity) {
    // statusCode: 'active' | 'paused' | 'none' (outros mapeados para 'none')
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
  function renderTable(rows, page, total, limit) {
    state.lastItems = rows || [];
    state.page = page;

    const tb = qs('#grid tbody');
    tb.innerHTML = '';

    const T = state.totals || {};
    const uTotal = Number(T.units_total || 0);
    const rTotal = Number(T.revenue_cents_total || 0);

    (rows || []).forEach(r => {
      const curve = r.curve || '-';
      const pillClass = curve ? `idx-${curve}` : '';
      const unitShare = typeof r.unit_share === 'number' ? r.unit_share : (uTotal > 0 ? (r.units || 0) / uTotal : 0);
      const revShare  = typeof r.revenue_share === 'number' ? r.revenue_share : (rTotal > 0 ? (r.revenue_cents || 0) / rTotal : 0);

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
        <td>${r.sku || ''}</td>
        <td>${r.title || ''}</td>
        <td>${r.logistic_type || ''}</td>
        <td>${(r.units || 0).toLocaleString('pt-BR')}</td>
        <td class="percent">${fmtPct(unitShare)}</td>
        <td class="num">${fmtMoneyCents(r.revenue_cents || 0)}</td>
        <td class="percent">${fmtPct(revShare)}</td>

        <td>${adsBadgeHTML(statusCode, statusText, hasActivity)}</td>
        <td class="num">${clicks.toLocaleString('pt-BR')}</td>
        <td class="num">${imps.toLocaleString('pt-BR')}</td>
        <td class="num">${fmtMoneyCents(spendC)}</td>
        <td class="percent">${hasActivity && acosVal !== null ? fmtPct(acosVal) : '—'}</td>
        <td class="num">${fmtMoneyCents(aRevC)}</td>
      `;
      tb.appendChild(tr);
    });

    renderPagination(page, total, limit);
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

  // ===== Items Loader
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
      const r = await fetch(`/api/analytics/abc-ml/items?${params}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`items HTTP ${r.status}`);
      const j = await r.json();

      let rows = j.data || [];

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

      renderTable(rows, j.page || page, j.total || rows.length, j.limit || state.limit);
    } catch (e) {
      console.error(e);
      alert('❌ Falha ao carregar itens da Curva ABC.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllPages() {
    let page = 1, all = [], totalPages = 1;
    const limit = 500;

    do {
      const base = getFilters({ curve: state.curveTab || 'ALL', page, limit, include_ads: '1' });
      const params = new URLSearchParams(base).toString();
      const r = await fetch(`/api/analytics/abc-ml/items?${params}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();

      all = all.concat(j.data || []);
      totalPages = Math.ceil((j.total || 0) / (j.limit || limit));
      page++;
    } while (page <= totalPages);

    return all;
  }

  // ===== Export CSV (com status ADS textual e janelas fixas já existentes no backend)
  async function exportCSV() {
    try {
      setLoading(true);

      const allRows = await fetchAllPages();

      const rowsForCsv = allRows.slice();
      if (state.sort === 'share' || state.metric === 'revenue') {
        rowsForCsv.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
      } else {
        rowsForCsv.sort((a, b) => (b.units || 0) - (a.units || 0));
      }

      const uTotal = rowsForCsv.reduce((s, r) => s + (r.units || 0), 0);
      const rTotal = rowsForCsv.reduce((s, r) => s + (r.revenue_cents || 0), 0);

      const head = [
        'Índice','MLB','SKU','Título','Tipo Logístico',
        'Unidades','Unid. (%)','Valor','Participação',
        'ADS','Cliques','Impr.','Invest.','ACOS','Receita Ads',
        'Vendas 7D','Vendas 15D','Vendas 30D','Vendas 40D','Vendas 60D','Vendas 90D'
      ];

      const rows = rowsForCsv.map(r => {
        const unitShare = uTotal > 0 ? (r.units || 0) / uTotal : 0;
        const revShare  = rTotal > 0 ? (r.revenue_cents || 0) / rTotal : 0;

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
          r.sku || '',
          (r.title || '').replace(/"/g, '""'),
          r.logistic_type || '',
          (r.units || 0),
          (unitShare * 100).toFixed(2).replace('.', ',') + '%',
          (Number(r.revenue_cents || 0) / 100).toFixed(2).replace('.', ','),
          (revShare * 100).toFixed(2).replace('.', ',') + '%',
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

    } catch (e) {
      console.error(e);
      alert('❌ Falha ao exportar CSV: ' + e.message);
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
