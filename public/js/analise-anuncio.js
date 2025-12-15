// public/js/analise-anuncio.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  const inputSingle = $('#mlb-single');
  const btnOne     = $('#btn-analisar-um');

  const inputBulk  = $('#mlb-bulk');
  const btnBulk    = $('#btn-analisar-lote');
  const delayMsInp = $('#delay-ms');

  const bar        = $('#progress-bar');
  const barTxt     = $('#progress-text');
  const tbody      = $('#results-body');
  const btnDown    = $('#btn-download');

  // Paginação (25 por página)
  const PAGE_SIZE = 25;
  let currentPage = 1;

  // Armazena as respostas cruas do backend
  const results = [];

  const money = (v, moeda = 'BRL') =>
    (v === null || v === undefined || Number.isNaN(Number(v)))
      ? '—'
      : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda });

  function setProgress(cur, total) {
    const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (barTxt) barTxt.textContent = `${cur} / ${total}`;
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  }

  function setPage(p) {
    const total = getTotalPages();
    currentPage = Math.min(total, Math.max(1, Number(p) || 1));
    renderTabela();
    renderPaginacao();
  }

  function getPageSlice() {
    const start = (currentPage - 1) * PAGE_SIZE;
    return results.slice(start, start + PAGE_SIZE);
  }

  function renderPaginacao() {
    const wrap = document.getElementById('results-pagination');
    const ind  = document.getElementById('page-indicator');
    const prev = document.getElementById('btn-page-prev');
    const next = document.getElementById('btn-page-next');

    if (!wrap || !ind || !prev || !next) return;

    const totalPages = getTotalPages();
    const hasRows = results.length > 0;

    wrap.style.display = hasRows ? 'flex' : 'none';
    ind.textContent = `Página ${currentPage} de ${totalPages}`;

    prev.disabled = !hasRows || currentPage <= 1;
    next.disabled = !hasRows || currentPage >= totalPages;
  }

  function renderTabela() {
    if (!tbody) return;

    if (results.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="16" style="text-align:center;color:#6b7280;">Sem resultados ainda</td></tr>';
      if (btnDown) btnDown.disabled = true;
      renderPaginacao();
      return;
    }

    const pageRows = getPageSlice();
    const startIndex = (currentPage - 1) * PAGE_SIZE;

    tbody.innerHTML = pageRows.map((r, i) => {
      const idx = startIndex + i + 1;
      const moeda = r.moeda || 'BRL';

      const statusHtml = r.success
        ? '<span class="badge-ok">OK</span>'
        : `<span class="badge-err">${r.status || 'Erro'}</span>`;

      return `
        <tr>
          <td>${idx}</td>
          <td>${r.mlb || '—'}</td>
          <td>${r.tipo || '—'}</td>
          <td>${r.data_criacao_fmt || '—'}</td>
          <td>${r.ultima_venda_fmt || '—'}</td>
          <td>${r.tempo_desde_ultima_venda || '—'}</td>

          <td>${r.vendas_30d ?? '0'}</td>
          <td>${r.vendas_60d ?? '0'}</td>
          <td>${r.vendas_90d ?? '0'}</td>

          <td>${money(r.receita_30d, moeda)}</td>
          <td>${money(r.receita_60d, moeda)}</td>
          <td>${money(r.receita_90d, moeda)}</td>

          <td>${r.tempo_medio_entre_vendas || '—'}</td>

          <td>${r.ads_disponivel ? money(r.gasto_ads_30d, moeda) : '—'}</td>
          <td>${r.ads_disponivel ? money(r.gasto_ads_60d, moeda) : '—'}</td>
          <td>${r.ads_disponivel ? money(r.gasto_ads_90d, moeda) : '—'}</td>

          <td>${statusHtml}</td>
        </tr>
      `;
    }).join('');

    if (btnDown) btnDown.disabled = results.length === 0;
  }

  async function analisarUm(mlb) {
    const r = await fetch('/api/analise-anuncios/analisar-item', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mlb })
    });

    // Se vier erro HTTP, tenta mostrar mensagem do backend
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        msg = j.error || j.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const json = await r.json();
    return json;
  }

  function pushResultAndRefresh(data) {
    results.push(data);

    // Se estamos vazios e entrou o primeiro, reseta para página 1
    // E sempre que entra mais dados, mantemos você na última página (opcional)
    // Vou deixar numa UX boa: ir pra última página quando estiver em lote.
    renderTabela();
    renderPaginacao();
  }

  // ===== Eventos =====

  // MLB único
  btnOne?.addEventListener('click', async () => {
    const v = String(inputSingle?.value || '').trim();
    if (!v) return alert('Informe um MLB.');

    setProgress(0, 1);
    btnOne.disabled = true;

    try {
      const data = await analisarUm(v);
      currentPage = 1; // single: mostra logo no começo
      pushResultAndRefresh(data);
      setProgress(1, 1);
    } catch (e) {
      const fail = { success: false, mlb: v, status: 'ERRO', message: e?.message || String(e) };
      currentPage = 1;
      pushResultAndRefresh(fail);
      setProgress(1, 1);
    } finally {
      btnOne.disabled = false;
      if (btnDown) btnDown.disabled = results.length === 0;
      renderTabela();
      renderPaginacao();
    }
  });

  // Lote
  btnBulk?.addEventListener('click', async () => {
    const lines = (inputBulk?.value || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    if (lines.length === 0) return alert('Cole ao menos um MLB na área de texto.');
    const delay = Math.max(0, parseInt(delayMsInp?.value || '0', 10) || 0);

    btnBulk.disabled = true;
    setProgress(0, lines.length);

    let done = 0;
    for (const mlb of lines) {
      try {
        const data = await analisarUm(mlb);
        // No lote, vamos sempre mostrar a ÚLTIMA página (onde os itens novos entram)
        results.push(data);
      } catch (e) {
        const fail = { success: false, mlb, status: 'ERRO', message: e?.message || String(e) };
        results.push(fail);
      } finally {
        done++;
        setProgress(done, lines.length);

        // ir para última página e renderizar (assim você vê chegando)
        currentPage = 1;
        renderTabela();
        renderPaginacao();
      }

      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }

    if (btnDown) btnDown.disabled = results.length === 0;
    btnBulk.disabled = false;
  });

  // Paginação (botões)
  document.getElementById('btn-page-prev')?.addEventListener('click', () => setPage(currentPage - 1));
  document.getElementById('btn-page-next')?.addEventListener('click', () => setPage(currentPage + 1));

  // Download XLSX/CSV (EXPORTA TUDO, não só a página)
  btnDown?.addEventListener('click', async () => {
    if (results.length === 0) return;

    const rows = results.map(r => ({
      mlb: r.mlb || '',
      tipo: r.tipo || '',
      data_criacao: r.data_criacao_fmt || '',
      ultima_venda: r.ultima_venda_fmt || '',
      tempo_desde_ultima_venda: r.tempo_desde_ultima_venda || '',

      vendas_30d: r.vendas_30d ?? 0,
      vendas_60d: r.vendas_60d ?? 0,
      vendas_90d: r.vendas_90d ?? 0,

      receita_30d: r.receita_30d ?? 0,
      receita_60d: r.receita_60d ?? 0,
      receita_90d: r.receita_90d ?? 0,
      moeda: r.moeda || 'BRL',

      tempo_medio_entre_vendas: r.tempo_medio_entre_vendas || '',

      gasto_ads_30d: r.gasto_ads_30d ?? null,
      gasto_ads_60d: r.gasto_ads_60d ?? null,
      gasto_ads_90d: r.gasto_ads_90d ?? null,
      ads_disponivel: r.ads_disponivel === true,

      success: r.success === true,
      status: r.status || ''
    }));

    try {
      const resp = await fetch('/api/analise-anuncios/gerar-xlsx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows })
      });

      if (!resp.ok) {
        const t = await resp.text();
        return alert('Falha ao gerar arquivo: ' + t);
      }

      const ct = resp.headers.get('content-type') || '';
      const cd = resp.headers.get('content-disposition') || '';
      const blob = await resp.blob();

      let filename = (cd.match(/filename="([^"]+)"/)?.[1]) || `analise-anuncios-${Date.now()}`;
      if (ct.includes('spreadsheetml')) filename = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
      else if (ct.includes('text/csv')) filename = filename.endsWith('.csv') ? filename : filename + '.csv';

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch (e) {
      alert('Erro ao baixar: ' + (e?.message || e));
    }
  });

  // boot
  renderTabela();
  renderPaginacao();
})();
