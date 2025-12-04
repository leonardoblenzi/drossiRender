// public/js/publicidade.js
(() => {
  console.log('🚀 publicidade.js carregado');

  // ==========================================
  // Helpers básicos
  // ==========================================
  const qs  = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const esc = (s) => (s == null
    ? ''
    : String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[c]))
  );

  const fmtMoney = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const fmtNumber = (v, d = 0) => {
    const n = Number(v);
    if (!isFinite(n)) return '0';
    return n.toLocaleString('pt-BR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  };

  const fmtPct = (v, d = 2) => {
    const n = Number(v);
    if (!isFinite(n)) return '0,00%';
    return `${n.toFixed(d).replace('.', ',')}%`;
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  function getDateRange() {
    // usa os IDs reais do HTML
    const inpFrom = qs('#dateFrom');
    const inpTo   = qs('#dateTo');

    let from = inpFrom?.value || addDays(-30); // últimos 30 dias
    let to   = inpTo?.value   || todayISO();

    // sanidade básica
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    if (inpFrom) inpFrom.value = from;
    if (inpTo)   inpTo.value   = to;

    return { from, to };
  }

  function setLoadingTable(tbody, msg = 'Carregando…') {
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="99" class="muted">${esc(msg)}</td></tr>`;
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  // ==========================================
  // Estado
  // ==========================================
  const state = {
    date_from: null,
    date_to: null,
    campaigns: [],
    itemsByCampaign: new Map(), // campaign_id -> { date_from, date_to, items }
    selectedCampaignId: null,
    chart: null,
    chartSeries: [],
    itemsPage: 1,
    itemsPerPage: 20,
  };

  // ==========================================
  // DOM hooks
  // ==========================================
  const $campBody   = () => qs('#tbodyCampaigns');
  const $itemsBody  = () => qs('#tbodyItems');
  const $campTitle  = () => qs('#campaignTitle');
  const $campSub    = () => qs('#campaignSubtitle');
  const $btnExport  = () => qs('#btnExportCsv');
  const $pagination = () => qs('#adsPagination');

  // ==========================================
  // RESUMO GERAL (cards do topo)
  // ==========================================
  function atualizarResumoGeral() {
    const list = state.campaigns || [];
    if (!list.length) {
      setText('sumCost',   'R$ 0,00');
      setText('sumClicks', '0');
      setText('sumPrints', '0');
      setText('avgCtr',    '0,00%');
      setText('avgAcos',   '0,00%');
      setText('avgRoas',   '0,00x');
      setText('sumUnits',  '0');
      setText('sumAmount', 'R$ 0,00');
      return;
    }

    let clicks = 0;
    let prints = 0;
    let cost   = 0;
    let units  = 0;
    let amount = 0;

    for (const c of list) {
      const m = c.metrics || {};
      clicks += Number(m.clicks || 0);
      prints += Number(m.prints || 0);
      cost   += Number(m.cost   || 0);
      units  += Number(m.units_quantity || 0);
      amount += Number(m.total_amount   || 0);
    }

    const ctr  = prints > 0 ? (clicks / prints) * 100 : 0;
    const acos = amount > 0 ? (cost / amount) * 100 : 0;
    const roas = cost   > 0 ? (amount / cost) : 0;

    setText('sumCost',   fmtMoney(cost));
    setText('sumClicks', fmtNumber(clicks));
    setText('sumPrints', fmtNumber(prints));
    setText('avgCtr',    fmtPct(ctr));
    setText('avgAcos',   fmtPct(acos));
    setText('avgRoas',   `${fmtNumber(roas || 0, 2)}x`);
    setText('sumUnits',  fmtNumber(units));
    setText('sumAmount', fmtMoney(amount));
  }

  // ==========================================
  // Fetch – campanhas
  // ==========================================
  async function carregarCampanhas() {
    const tbody = $campBody();
    const { from, to } = getDateRange();
    state.date_from = from;
    state.date_to   = to;

    setText('rankingPeriod', `Período: ${from} a ${to}`);
    setLoadingTable(tbody, `Carregando campanhas de ${from} até ${to}…`);

    const url =
      `/api/publicidade/product-ads/campaigns?date_from=${encodeURIComponent(from)}` +
      `&date_to=${encodeURIComponent(to)}`;

    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        console.error('Erro ao carregar campanhas:', r.status, txt);
        tbody.innerHTML =
          `<tr><td colspan="99" class="muted">Falha ao carregar campanhas (HTTP ${r.status}).</td></tr>`;
        state.campaigns = [];
        atualizarResumoGeral();
        atualizarResumoCampanha(null);
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
      state.campaigns = campaigns;

      renderCampanhas();
      atualizarResumoGeral();

      const itemsBody = $itemsBody();
      if (!campaigns.length) {
        atualizarResumoCampanha(null);
        if (itemsBody) {
          itemsBody.innerHTML =
            `<tr><td colspan="99" class="muted">Nenhuma campanha encontrada no período.</td></tr>`;
        }
        const btn = $btnExport();
        if (btn) btn.disabled = true;
        return;
      }

      // Se não tiver campanha selecionada, seleciona a primeira
      if (!state.selectedCampaignId && campaigns[0]) {
        selecionarCampanha(campaigns[0].id);
      } else {
        atualizarResumoCampanha(state.selectedCampaignId);
      }
    } catch (e) {
      console.error('Erro inesperado ao buscar campanhas:', e);
      if (tbody) {
        tbody.innerHTML =
          `<tr><td colspan="99" class="muted">Erro ao buscar campanhas (ver console).</td></tr>`;
      }
    }
  }

  function renderCampanhas() {
    const tbody = $campBody();
    if (!tbody) return;

    const list = state.campaigns || [];
    if (!list.length) {
      tbody.innerHTML =
        `<tr><td colspan="18" class="muted">Nenhuma campanha para o período selecionado.</td></tr>`;
      return;
    }

    const rows = list.map((c) => {
      const m = c.metrics || {};
      const active = String(state.selectedCampaignId) === String(c.id);

      const className = [
        'row-campaign',
        active ? 'row-campaign--active' : '',
        (c.status === 'paused' ? 'row-campaign--paused' : ''),
      ].filter(Boolean).join(' ');

      const acosObj = (c.acos_target != null)
        ? fmtPct(c.acos_target)
        : '—';

      const acosVal = (m.acos != null)
        ? fmtPct(m.acos)
        : '—';

      const tacos = '—'; // não temos TACOS real
      const cpi = (m.prints > 0 && m.cost != null)
        ? fmtMoney(m.cost / m.prints)
        : 'R$ 0,00';

      const vendasPublicidade = fmtNumber(m.units_quantity ?? 0);
      const investimento = fmtMoney(m.cost);
      const receita = fmtMoney(m.total_amount);
      const retornos = (m.roas != null)
        ? `${fmtNumber(m.roas, 2)}x`
        : '0,00x';

      const ctrVal = (m.ctr != null)
        ? fmtPct(m.ctr)
        : '0,00%';

      return `
        <tr class="${className}" data-camp-id="${esc(c.id)}">
          <td class="sticky-col">
            <div class="camp-name">
              <span class="camp-title">${esc(c.name || c.id || '—')}</span>
            </div>
          </td>
          <td>${esc(c.status || '—')}</td>
          <td>${esc(c.strategy || '—')}</td>
          <td class="num">${acosObj}</td>
          <td class="num">${acosVal}</td>
          <td class="num">${tacos}</td>
          <td class="num">${cpi}</td>
          <td class="num">—</td>
          <td class="num">—</td>
          <td class="num">—</td>
          <td class="num">${vendasPublicidade}</td>
          <td class="num">${fmtNumber(m.prints ?? 0)}</td>
          <td class="num">${fmtNumber(m.clicks ?? 0)}</td>
          <td class="num">${investimento}</td>
          <td class="num">${fmtMoney(m.cpc)}</td>
          <td class="num">${ctrVal}</td>
          <td class="num">${receita}</td>
          <td class="num">${retornos}</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows;

    // delegação de clique
    tbody.onclick = (ev) => {
      const tr = ev.target.closest('tr[data-camp-id]');
      if (!tr) return;
      const id = tr.getAttribute('data-camp-id');
      if (!id) return;
      selecionarCampanha(id);
    };
  }

  // ==========================================
  // Seleção de campanha & resumo
  // ==========================================
  function selecionarCampanha(campaignId) {
    state.selectedCampaignId = String(campaignId || '');
    state.itemsPage = 1; // reseta página

    // destaca na tabela
    const tbody = $campBody();
    if (tbody) {
      qsa('tr[data-camp-id]', tbody).forEach((tr) => {
        const id = tr.getAttribute('data-camp-id');
        tr.classList.toggle(
          'row-campaign--active',
          String(id) === state.selectedCampaignId
        );
      });
    }

    atualizarResumoCampanha(state.selectedCampaignId);
    carregarItensCampanha(state.selectedCampaignId);

    const btn = $btnExport();
    if (btn) btn.disabled = !campaignId;
  }

  function atualizarResumoCampanha(campaignId) {
    const titleEl = $campTitle();
    const subEl   = $campSub();

    if (!campaignId) {
      if (titleEl) titleEl.textContent = 'Campanha selecionada: —';
      if (subEl) {
        subEl.textContent =
          'Selecione uma campanha no ranking para ver os anúncios e métricas.';
      }
      setText('detailClicks',  '0');
      setText('detailPrints',  '0');
      setText('detailCtr',     '0,00%');
      setText('detailCost',    'R$ 0,00');
      setText('detailCpc',     'R$ 0,00');
      setText('detailAcos',    '0,00%');
      setText('detailRoas',    '0,00x');
      setText('detailUnits',   '0');
      setText('detailAmount',  'R$ 0,00');
      return;
    }

    const camp = state.campaigns.find((c) => String(c.id) === String(campaignId));
    if (!camp) {
      if (titleEl) titleEl.textContent = 'Campanha não localizada';
      if (subEl)   subEl.textContent   = '';
      return;
    }

    const m = camp.metrics || {};
    const from = state.date_from || '—';
    const to   = state.date_to   || '—';

    if (titleEl) {
      titleEl.textContent = `Campanha: “${camp.name || camp.id}”`;
    }

    if (subEl) {
      const acosDisplay = (m.acos != null)
        ? fmtPct(m.acos)
        : '0,00%';
      const roasDisplay = (m.roas != null)
        ? `${fmtNumber(m.roas, 2)}x`
        : '0,00x';

      subEl.textContent =
        `Período ${from} a ${to} • Cliques: ${fmtNumber(m.clicks ?? 0)} ` +
        `• Custo: ${fmtMoney(m.cost)} • ACOS: ${acosDisplay} • ROAS: ${roasDisplay}`;
    }

    setText('detailClicks', fmtNumber(m.clicks ?? 0));
    setText('detailPrints', fmtNumber(m.prints ?? 0));
    setText('detailCtr',    fmtPct(m.ctr != null ? m.ctr : 0));
    setText('detailCost',   fmtMoney(m.cost));
    setText('detailCpc',    fmtMoney(m.cpc));
    setText('detailAcos',   fmtPct(m.acos != null ? m.acos : 0));
    setText('detailRoas',   `${fmtNumber(m.roas ?? 0, 2)}x`);
    setText('detailUnits',  fmtNumber(m.units_quantity ?? 0));
    setText('detailAmount', fmtMoney(m.total_amount));
  }

  // ==========================================
  // Fetch – itens da campanha
  // ==========================================
  async function carregarItensCampanha(campaignId) {
    const tbody = $itemsBody();
    const pag   = $pagination();
    if (pag) pag.innerHTML = '';
    if (!tbody) return;

    if (!campaignId) {
      tbody.innerHTML =
        `<tr><td colspan="99" class="muted">Selecione uma campanha.</td></tr>`;
      return;
    }

    // cache simples em memória por campanha
    const cached = state.itemsByCampaign.get(String(campaignId));
    if (cached &&
        cached.date_from === state.date_from &&
        cached.date_to   === state.date_to) {
      renderItens(cached.items);
      return;
    }

    setLoadingTable(tbody, 'Carregando itens da campanha…');

    const from = state.date_from || addDays(-30);
    const to   = state.date_to   || todayISO();

    const url =
      `/api/publicidade/product-ads/campaigns/${encodeURIComponent(campaignId)}/items` +
      `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`;

    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        console.error('Erro ao carregar itens da campanha:', r.status, txt);
        tbody.innerHTML =
          `<tr><td colspan="99" class="muted">Falha ao carregar itens (HTTP ${r.status}).</td></tr>`;
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const items = Array.isArray(data.items) ? data.items : [];

      state.itemsByCampaign.set(String(campaignId), {
        date_from: from,
        date_to: to,
        items,
      });

      state.itemsPage = 1;
      renderItens(items);
    } catch (e) {
      console.error('Erro inesperado ao buscar itens da campanha:', e);
      tbody.innerHTML =
        `<tr><td colspan="99" class="muted">Erro ao buscar itens (ver console).</td></tr>`;
    }
  }

  // Paginação simples de itens (20 por página)
  function renderItensPagination(totalItems) {
    const container = $pagination();
    if (!container) return;

    const perPage = state.itemsPerPage;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const current = Math.min(Math.max(1, state.itemsPage), totalPages);

    let html = '';

    html += `<button class="btn btn-sm" data-page="prev" ${current === 1 ? 'disabled' : ''}>‹</button>`;
    html += `<span class="items-pagination__info">Página ${current} de ${totalPages}</span>`;
    html += `<button class="btn btn-sm" data-page="next" ${current === totalPages ? 'disabled' : ''}>›</button>`;

    container.innerHTML = html;

    container.onclick = (ev) => {
      const btn = ev.target.closest('[data-page]');
      if (!btn) return;
      const type = btn.getAttribute('data-page');
      if (type === 'prev' && state.itemsPage > 1) {
        state.itemsPage -= 1;
      } else if (type === 'next' && state.itemsPage < totalPages) {
        state.itemsPage += 1;
      } else {
        return;
      }
      const campId = state.selectedCampaignId;
      if (!campId) return;
      const cached = state.itemsByCampaign.get(String(campId));
      if (!cached) return;
      renderItens(cached.items);
    };
  }

  function renderItens(items) {
    const tbody = $itemsBody();
    if (!tbody) return;

    if (!items || !items.length) {
      tbody.innerHTML =
        `<tr><td colspan="12" class="muted">Nenhum item com métricas para esta campanha no período.</td></tr>`;
      renderItensPagination(0);
      return;
    }

    const perPage = state.itemsPerPage;
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, state.itemsPage), totalPages);
    state.itemsPage = page;

    const start = (page - 1) * perPage;
    const end   = start + perPage;
    const pageItems = items.slice(start, end);

    const rows = pageItems.map((it) => {
      const m = it.metrics || {};

      const ctrVal  = (m.ctr  != null) ? fmtPct(m.ctr)  : '0,00%';
      const acosVal = (m.acos != null) ? fmtPct(m.acos) : '0,00%';

      const tacosVal  = '—';
      const vendasPub = fmtNumber(m.units_quantity ?? 0);
      const convPub   =
        (m.clicks > 0 && m.units_quantity > 0)
          ? fmtPct((m.units_quantity / m.clicks) * 100)
          : '—';

      const statusClass =
        it.status === 'active'
          ? 'is-active'
          : (it.status === 'paused' ? 'is-paused' : '');

      const qualityClass = 'quality-badge--na';
      const qualityLabel = 'N/D';

      const firstLetter = (it.title || '').trim().charAt(0).toUpperCase() || 'P';

      const thumbHtml = it.thumbnail
        ? `<img src="${esc(it.thumbnail)}" alt="${esc(it.title || '')}" class="ads-item-thumb__img" loading="lazy">`
        : `<span class="ads-item-thumb__fallback">${esc(firstLetter)}</span>`;

      return `
        <tr class="ads-item-row" data-item-id="${esc(it.item_id || '')}">
          <td class="sticky-col">
            <div class="ads-item-product">
              <div class="ads-item-thumb">
                ${thumbHtml}
              </div>
              <div class="ads-item-info">
                <div class="ads-item-title">${esc(it.title || '—')}</div>
                <div class="ads-item-meta">
                  <span>SKU: ${esc(it.sku || '—')}</span>
                  <span>MLB: ${esc(it.item_id || it.id || '—')}</span>
                  <span class="ads-item-status ${statusClass}">
                    ${esc(it.status || '—')}
                  </span>
                </div>
              </div>
            </div>
          </td>

          <td class="num">
            <div class="quality-badge ${qualityClass}">
              ${qualityLabel}
            </div>
          </td>

          <td class="num">${acosVal}</td>
          <td class="num">${tacosVal}</td>
          <td class="num">${fmtNumber(m.prints ?? 0)}</td>
          <td class="num">${fmtNumber(m.clicks ?? 0)}</td>
          <td class="num">${ctrVal}</td>
          <td class="num">${fmtMoney(it.cpc)}</td>
          <td class="num">${convPub}</td>
          <td class="num">${vendasPub}</td>
          <td class="num">—</td>
          <td class="num">—</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows;
    renderItensPagination(total);
  }

  // ==========================================
  // MÉTRICAS DIÁRIAS (gráfico)
  // ==========================================
  async function carregarMetricasDiarias() {
    const canvas = document.getElementById('adsMetricsChart');
    if (!canvas) return;

    const { from, to } = getDateRange();
    state.date_from = from;
    state.date_to   = to;
    setText('rankingPeriod', `Período: ${from} a ${to}`);

    const url =
      `/api/publicidade/product-ads/metrics/daily?date_from=${encodeURIComponent(from)}` +
      `&date_to=${encodeURIComponent(to)}`;

    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        console.error('Erro ao carregar métricas diárias:', r.status, txt);
        atualizarGrafico([]);
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const series = Array.isArray(data.results || data.series)
        ? (data.results || data.series)
        : [];

      state.chartSeries = series;
      atualizarGrafico(series);
    } catch (e) {
      console.error('Erro inesperado ao carregar métricas diárias:', e);
      if (state.chart) {
        try { state.chart.destroy(); } catch (_) {}
        state.chart = null;
      }
    }
  }

  function atualizarGrafico(series) {
    const canvas = document.getElementById('adsMetricsChart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
      console.warn('Chart.js não carregado – gráfico de métricas não será exibido.');
      return;
    }

    if (!series || !series.length) {
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      return;
    }

    const labels = series.map((row) => {
      const d = row.date || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const [y, m, day] = d.split('-');
      return `${day}/${m}`;
    });

    const impressions = series.map(r => Number(r.prints || 0));
    const clicks      = series.map(r => Number(r.clicks || 0));
    const cost        = series.map(r => Number(r.cost || 0));
    const revenue     = series.map(r => Number(r.total_amount || 0));

    const ctx = canvas.getContext('2d');

    const datasets = [
      { label: 'Impressões', data: impressions, yAxisID: 'y2', borderWidth: 2, tension: 0.3 },
      { label: 'Cliques',    data: clicks,      yAxisID: 'y1', borderWidth: 2, tension: 0.3 },
      { label: 'Investimento', data: cost,      yAxisID: 'y1', borderWidth: 2, tension: 0.3 },
      { label: 'Faturamento', data: revenue,    yAxisID: 'y1', borderWidth: 2, tension: 0.3 },
    ];

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets = datasets;
      state.chart.update();
      return;
    }

    state.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y1: {
            type: 'linear',
            position: 'left',
            ticks: {
              callback(value) {
                return value.toLocaleString('pt-BR');
              },
            },
          },
          y2: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: {
              callback(value) {
                return value.toLocaleString('pt-BR');
              },
            },
          },
        },
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    });
  }

  // ==========================================
  // Eventos de UI
  // ==========================================
  function bindUI() {
    const form = qs('#ads-filters');
    if (form) {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        carregarCampanhas();
        carregarMetricasDiarias();
      });
    }

    const btnReload = qs('#btnReloadAds');
    if (btnReload) {
      btnReload.addEventListener('click', (ev) => {
        ev.preventDefault();
        carregarCampanhas();
        carregarMetricasDiarias();
      });
    }

    const btnExport = $btnExport();
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        const id = state.selectedCampaignId;
        if (!id) return;

        const { from, to } = getDateRange();
        const url =
          `/api/publicidade/product-ads/campaigns/${encodeURIComponent(id)}/export` +
          `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`;

        window.open(url, '_blank');
      });
    }
  }

  // ==========================================
  // Boot
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    try {
      getDateRange();   // seta últimos 30 dias nos inputs
      bindUI();
      carregarCampanhas();
      carregarMetricasDiarias();
    } catch (e) {
      console.error('Erro ao inicializar publicidade.js:', e);
    }
  });
})();
