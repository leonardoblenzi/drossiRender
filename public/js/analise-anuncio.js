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

  const results = []; // armazena as respostas cruas do backend

  const money = (v, moeda='BRL') =>
    (v === null || v === undefined)
      ? '—'
      : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda });

  function setProgress(cur, total) {
    const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    barTxt.textContent = `${cur} / ${total}`;
  }

  function ensureTableReady() {
    if (tbody.children.length === 1 && tbody.children[0].querySelector('td[colspan]')) {
      tbody.innerHTML = ''; // limpa linha "Sem resultados ainda"
    }
  }

  function renderRow(r, idx) {
    ensureTableReady();
    const moeda = r.moeda || 'BRL';

    const tr = document.createElement('tr');
    tr.innerHTML = `
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

      <td>${
        r.success
          ? '<span class="badge-ok">OK</span>'
          : `<span class="badge-err">${r.status || 'Erro'}</span>`
      }</td>
    `;
    tbody.appendChild(tr);
  }

  async function analisarUm(mlb) {
    const r = await fetch('/api/analise-anuncios/analisar-item', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mlb })
    });
    return r.json();
  }

  // Botão: MLB único
  btnOne.addEventListener('click', async () => {
    const v = String(inputSingle.value || '').trim();
    if (!v) return alert('Informe um MLB.');

    setProgress(0, 1);
    btnOne.disabled = true;

    try {
      const data = await analisarUm(v);
      results.push(data);
      renderRow(data, results.length);
      setProgress(1, 1);
      btnDown.disabled = results.length === 0;
    } catch (e) {
      const fail = { success:false, mlb:v, status:'ERRO', message: e?.message || String(e) };
      results.push(fail);
      renderRow(fail, results.length);
    } finally {
      btnOne.disabled = false;
    }
  });

  // Botão: Lote
  btnBulk.addEventListener('click', async () => {
    const lines = (inputBulk.value || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    if (lines.length === 0) return alert('Cole ao menos um MLB na área de texto.');
    const delay = Math.max(0, parseInt(delayMsInp.value || '0', 10) || 0);

    btnBulk.disabled = true;
    setProgress(0, lines.length);

    let done = 0;
    for (const mlb of lines) {
      try {
        const data = await analisarUm(mlb);
        results.push(data);
        renderRow(data, results.length);
      } catch (e) {
        const fail = { success:false, mlb, status:'ERRO', message: e?.message || String(e) };
        results.push(fail);
        renderRow(fail, results.length);
      } finally {
        done++;
        setProgress(done, lines.length);
      }
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }

    btnDown.disabled = results.length === 0;
    btnBulk.disabled = false;
  });

  // Download XLSX / CSV (auto detecta pelo Content-Type)
  btnDown.addEventListener('click', async () => {
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
      ads_disponivel: r.ads_disponivel === true
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

      // tenta extrair filename do header; fallback por extensão conforme content-type
      let filename = (cd.match(/filename="([^"]+)"/)?.[1]) || `analise-anuncios-${Date.now()}`;
      if (ct.includes('spreadsheetml')) filename = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
      else if (ct.includes('text/csv'))   filename = filename.endsWith('.csv')  ? filename : filename + '.csv';

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
})();
