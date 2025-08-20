// public/js/analise-anuncios.js
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const inputSingle = $('#mlb-single');
  const btnOne     = $('#btn-analisar-um');

  const inputBulk  = $('#mlb-bulk');
  const btnBulk    = $('#btn-analisar-lote');
  const delayMsInp = $('#delay-ms');

  const bar        = $('#progress-bar');
  const barTxt     = $('#progress-text');
  const tbody      = $('#results-body');
  const btnXlsx    = $('#btn-download');

  const results = []; // { mlb, ultima_venda, tipo, tempo_desde_ultima_venda, success, erro? }

  function setProgress(cur, total) {
    const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    barTxt.textContent = `${cur} / ${total}`;
  }

  function appendRow(row, idx) {
    if (tbody.children.length === 1 && tbody.children[0].querySelector('td[colspan]')) {
      tbody.innerHTML = ''; // limpa "Sem resultados"
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx}</td>
      <td>${row.mlb || '—'}</td>
      <td>${row.ultima_venda || '—'}</td>
      <td>${row.tipo || '—'}</td>
      <td>${row.tempo_desde_ultima_venda || '—'}</td>
      <td>${row.success ? '✅ OK' : `❌ ${row.erro || 'Falha'}`}</td>
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
    try {
      btnOne.disabled = true;
      const data = await analisarUm(v);
      results.push(data);
      appendRow(data, results.length);
      setProgress(1, 1);
      btnXlsx.disabled = results.length === 0;
    } catch (e) {
      alert('Erro ao analisar: ' + (e?.message || e));
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
        appendRow(data, results.length);
      } catch (e) {
        const fail = { success: false, mlb, erro: e?.message || String(e) };
        results.push(fail);
        appendRow(fail, results.length);
      } finally {
        done++;
        setProgress(done, lines.length);
      }
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    btnXlsx.disabled = results.length === 0;
    btnBulk.disabled = false;
  });

  // Download XLSX
  btnXlsx.addEventListener('click', async () => {
    if (results.length === 0) return;
    // monta linhas limpas para export (somente os campos pedidos)
    const rows = results.map(r => ({
      mlb: r.mlb || '',
      ultima_venda: r.ultima_venda || '',
      tipo: r.tipo || '',
      tempo_desde_ultima_venda: r.tempo_desde_ultima_venda || ''
    }));

    try {
      const resp = await fetch('/api/analise-anuncios/gerar-xlsx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      if (!resp.ok) {
        const t = await resp.text();
        return alert('Falha ao gerar XLSX: ' + t);
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `analise-anuncios-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch (e) {
      alert('Erro ao baixar XLSX: ' + (e?.message || e));
    }
  });
})();
