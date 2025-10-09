// public/js/full.js
(() => {
  console.log('🚚 Full • Produtos');

  /* ========= Helpers ========= */
  const qs = (s, el=document) => el.querySelector(s);
  const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));
  const $ = (id) => document.getElementById(id);
  const toAbs = (p) => (/^https?:\/\//i.test(p) ? p : (p.startsWith('/') ? p : `/${p}`));
  const safeOn = (el, type, fn) => { if (el) el.addEventListener(type, fn); };

  const state = {
    page: 1,
    pageSize: Number(localStorage.getItem('full.pageSize') || 25),
    q: localStorage.getItem('full.q') || '',
    status: localStorage.getItem('full.status') || 'all',
    loading: false,
    total: 0,
    rows: []
  };

  /* ========= UI refs ========= */
  const $tbody = $('tbody');
  const $error = $('errorBox');
  const $countTotal = $('countTotal');
  const $pageInfo = $('pageInfo');
  const $q = $('q');
  const $pageSize = $('pageSize');
  const $prev = $('prev');
  const $next = $('next');
  const $btnReload = $('btnReload');
  const $btnCSV = $('btnCSV');

  /* ========= API =========
     GET /api/full/products?page=&page_size=&q=&status=
     -> { items, total, page, page_size }
  */
  async function jget(url) {
    const r = await fetch(toAbs(url), { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status} ${url} ${t}`.trim());
    }
    return r.json();
  }

  function money(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function badgeStatus(s) {
    const map = {
      active:     { cls:'ok',    txt:'Ativo no Full' },
      intransfer: { cls:'warn',  txt:'Em transferência' },
      ineligible: { cls:'muted', txt:'Inelegível' },
      no_stock:   { cls:'muted', txt:'Sem estoque no CD' },
    };
    const hit = map[s] || { cls:'muted', txt: String(s || '—') };
    return `<span class="badge ${hit.cls}">${hit.txt}</span>`;
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).catch(()=>{});
  }

  /* ========= Render ========= */
  function skeletonRows(n=8) {
    if (!$tbody) return;
    $tbody.innerHTML = '';
    for (let i=0; i<n; i++) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.innerHTML = `<div class="row-skel"></div>`;
      tr.appendChild(td);
      $tbody.appendChild(tr);
    }
  }

  function render() {
    if ($error) $error.style.display = 'none';
    if ($countTotal) $countTotal.textContent = `${state.total.toLocaleString('pt-BR')} itens`;
    if ($pageInfo) $pageInfo.textContent = `Página ${state.page}`;
    if ($pageSize) $pageSize.value = String(state.pageSize);
    if ($q) $q.value = state.q;

    // chips
    qsa('.chip').forEach(ch => {
      ch.classList.toggle('active', ch.dataset.status === state.status);
    });

    if (state.loading) {
      skeletonRows();
      return;
    }

    if (!$tbody) return;

    if (!state.rows.length) {
      $tbody.innerHTML = `<tr><td colspan="8"><div class="empty">Nenhum item encontrado.</div></td></tr>`;
      return;
    }

    const rows = state.rows.map(row => {
      const mlbHTML = `<a href="https://www.mercadolivre.com.br/anuncios/${row.mlb}" target="_blank" rel="noopener" title="Abrir no ML" class="mono">${row.mlb}</a>`;
      const promoTxt = row.promo_active ? 'Sim' : 'Não';
      const pctTxt = (row.promo_active && typeof row.promo_percent === 'number') ? `${row.promo_percent.toFixed(2)}%` : '—';

      return `
        <tr>
          <td class="mono" title="Clique para copiar MLB" style="cursor:pointer" data-copy="${row.mlb}">${mlbHTML}</td>
          <td>${row.title || '—'}</td>
          <td>${Number(row.stock_full||0).toLocaleString('pt-BR')}</td>
          <td>${money(row.price_cents)}</td>
          <td>${promoTxt}</td>
          <td>${pctTxt}</td>
          <td>${badgeStatus(row.status)}</td>
          <td>
            <button class="btn btn-mini" data-details="${row.mlb}">Detalhes</button>
            <button class="btn btn-mini" data-open="${row.mlb}">ML</button>
          </td>
        </tr>`;
    }).join('');

    $tbody.innerHTML = rows;

    // bind ações por linha
    qsa('[data-copy]').forEach(el => {
      el.addEventListener('click', () => copy(el.dataset.copy));
    });
    qsa('[data-open]').forEach(el => {
      el.addEventListener('click', () => {
        const mlb = el.dataset.open;
        window.open(`https://www.mercadolivre.com.br/anuncios/${mlb}`, '_blank', 'noopener');
      });
    });
    qsa('[data-details]').forEach(el => {
      el.addEventListener('click', () => openDetails(el.dataset.details));
    });
  }

  /* ========= Data ========= */
  async function load() {
    try {
      state.loading = true;
      render();

      const url = `/api/full/products?page=${state.page}&page_size=${state.pageSize}&q=${encodeURIComponent(state.q||'')}&status=${encodeURIComponent(state.status)}`;
      const data = await jget(url);

      state.rows = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total || 0);
      state.page = Number(data.page || state.page);
      state.pageSize = Number(data.page_size || state.pageSize);

      state.loading = false;
      render();

      // desabilita paginação quando cabível
      const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
      if ($prev) $prev.disabled = state.page <= 1;
      if ($next) $next.disabled = state.page >= maxPage;
    } catch (e) {
      state.loading = false;
      if ($error) {
        $error.textContent = e.message || String(e);
        $error.style.display = '';
      } else {
        console.error('Erro Full • Produtos:', e);
      }
      state.rows = [];
      render();
    }
  }

  /* ========= CSV ========= */
  function exportCSV() {
    const headers = ['MLB','Título','Estoque Full','Preço','Promo','% Aplicada','Status'];
    const lines = [headers.join(';')];

    state.rows.forEach(r => {
      const promoTxt = r.promo_active ? 'Sim' : 'Não';
      const pctTxt = (r.promo_active && typeof r.promo_percent === 'number') ? r.promo_percent.toFixed(2) : '';
      const row = [
        r.mlb || '',
        (r.title || '').replace(/[\r\n;]+/g,' ').trim(),
        String(r.stock_full ?? ''),
        (Number(r.price_cents||0)/100).toFixed(2).replace('.',','), // BR
        promoTxt,
        pctTxt,
        r.status || ''
      ].map(v => `"${String(v).replace(/"/g,'""')}"`);
      lines.push(row.join(';'));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.href = URL.createObjectURL(blob);
    a.download = `full_produtos_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ========= Modal Detalhes ========= */
  const $modal = $('modalFullDetails');
  const $fdClose = $('fd-close');

  function openModal() { if ($modal) $modal.style.display = 'block'; }
  function closeModal() { if ($modal) $modal.style.display = 'none'; }

  $fdClose?.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });

  function fmtMoney(n) { return Number(n||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
  function fmtDateISO(d) { try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; } }
  function round2(n) { const x = Number(n); return (isFinite(x) ? x.toFixed(2) : '—'); }

  async function fetchDetails(mlb) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(`/api/full/product/${encodeURIComponent(mlb)}`, { cache:'no-store', signal: ctl.signal });
      if (!r.ok) {
        const txt = await r.text().catch(()=> '');
        throw new Error(`HTTP ${r.status} ${txt}`.trim());
      }
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function computeVelocity(sold40) {
    const total = Number(sold40 || 0);
    return total / 40; // un/dia
  }
  function computeDoc(stock, vel) {
    const v = Number(vel || 0);
    if (v <= 0) return null;
    return Number(stock || 0) / v; // dias
  }
  function computeOOS(docDays) {
    if (!isFinite(docDays) || docDays == null) return null;
    const dt = new Date();
    dt.setDate(dt.getDate() + Math.floor(docDays));
    return dt;
  }

  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function setLink(id, href) { const el = $(id); if (el) el.href = href; }
  function setImg(id, src) { const el = $(id); if (el) el.src = src || ''; }

  async function openDetails(mlb) {
    if (!$modal) {
      window.open(`https://www.mercadolivre.com.br/anuncios/${mlb}`, '_blank', 'noopener');
      return;
    }

    // limpa UI
    setText('fd-title', 'Carregando...');
    setText('fd-mlb', mlb);
    setText('fd-price', '—');
    setText('fd-promo', '—');
    setText('fd-stock', '—');
    setText('fd-sold40', '—');
    setText('fd-vel', '—');
    setText('fd-doc', '—');
    setText('fd-oos', '—');
    setImg('fd-image', '');
    setLink('fd-open-ml', `https://www.mercadolivre.com.br/anuncios/${mlb}`);
    const $skus = $('fd-skus');
    if ($skus) $skus.innerHTML = `<tr><td colspan="7"><div class="row-skel"></div></td></tr>`;
    const $err = $('fd-error');
    if ($err) { $err.style.display = 'none'; $err.textContent = ''; }

    openModal();

    try {
      const data = await fetchDetails(mlb);

      // header
      setText('fd-title', data.title || '—');
      setImg('fd-image', data.image || '');
      setText('fd-mlb', data.mlb || mlb);
      setText('fd-price', fmtMoney((data.price_cents || 0) / 100));
      const promoTxt = data.promo_active ? (typeof data.promo_percent==='number' ? `Sim (${data.promo_percent.toFixed(2)}%)` : 'Sim') : 'Não';
      setText('fd-promo', promoTxt);
      setText('fd-stock', Number(data.stock_full_total||0).toLocaleString('pt-BR'));

      // métricas gerais
      const sold40 = Number(data.sales_40d?.total || 0);
      const vel = computeVelocity(sold40);
      const doc = computeDoc(data.stock_full_total, vel);
      const oos = computeOOS(doc);

      setText('fd-sold40', sold40.toLocaleString('pt-BR'));
      setText('fd-vel', round2(vel));
      setText('fd-doc', doc == null ? '—' : round2(doc));
      setText('fd-oos', oos ? fmtDateISO(oos) : '—');

      // tabela de SKUs
      const rows = (data.skus || []).map(s => {
        const velSKU = computeVelocity(s.sold_40d || 0);
        const docSKU = computeDoc(s.stock_full, velSKU);
        const oosSKU = computeOOS(docSKU);
        return `
          <tr>
            <td class="mono">${s.sku || '—'}</td>
            <td>${s.variation || '—'}</td>
            <td>${Number(s.stock_full||0).toLocaleString('pt-BR')}</td>
            <td>${Number(s.sold_40d||0).toLocaleString('pt-BR')}</td>
            <td>${round2(velSKU)}</td>
            <td>${docSKU == null ? '—' : round2(docSKU)}</td>
            <td>${oosSKU ? fmtDateISO(oosSKU) : '—'}</td>
          </tr>`;
      }).join('');
      if ($skus) $skus.innerHTML = rows || `<tr><td colspan="7"><div class="empty">Sem variações/SKUs.</div></td></tr>`;
    } catch (e) {
      const $err = $('fd-error');
      if ($err) { $err.textContent = e.message || String(e); $err.style.display = ''; }
    }
  }

  // expõe para inspeção se precisar (não obrigatório)
  window.openDetails = openDetails;

  /* ========= Events ========= */
  function debounce(fn, ms=350) {
    let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }

  if ($q) safeOn($q, 'input', debounce(() => {
    state.q = $q.value.trim();
    localStorage.setItem('full.q', state.q);
    state.page = 1;
    load();
  }, 350));

  if ($pageSize) safeOn($pageSize, 'change', () => {
    state.pageSize = Number($pageSize.value);
    localStorage.setItem('full.pageSize', String(state.pageSize));
    state.page = 1;
    load();
  });

  qsa('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      state.status = ch.dataset.status;
      localStorage.setItem('full.status', state.status);
      state.page = 1;
      load();
    });
  });

  safeOn($prev, 'click', () => {
    if (state.page > 1) {
      state.page -= 1;
      load();
    }
  });
  safeOn($next, 'click', () => {
    const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page < maxPage) {
      state.page += 1;
      load();
    }
  });

  safeOn($btnReload, 'click', () => load());
  safeOn($btnCSV, 'click', () => exportCSV());

  // init
  if ($pageSize) $pageSize.value = String(state.pageSize);
  qsa('.chip').forEach(ch => ch.classList.toggle('active', ch.dataset.status === state.status));
  load();
})();
