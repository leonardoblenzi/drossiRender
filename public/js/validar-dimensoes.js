// public/js/validar-dimensoes.js
(() => {
  console.log('🚀 validar-dimensoes.js carregado');

  const $ = (id) => document.getElementById(id);
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  const ACCOUNT_LABELS = {
    drossi: 'DRossi Interiores',
    diplany: 'Diplany',
    rossidecor: 'Rossi Decor',
  };

  let currentAccountKey = null;
  let resultados = [];

  /* ==========================
   *  Conta atual / Trocar conta
   * ========================== */
  async function carregarContaAtual() {
    const el = $('account-current');
    try {
      const r = await fetch('/api/account/current', { cache: 'no-store' });
      const data = await r.json();
      let shown = 'Não selecionada';

      if (data && (data.ok || data.success)) {
        currentAccountKey = data.accountKey || null;
        shown =
          data.label ||
          ACCOUNT_LABELS[data.accountKey] ||
          data.accountKey ||
          'Desconhecida';
      } else if (data) {
        currentAccountKey = data.accountKey || null;
        shown = data.label || data.accountKey || 'Desconhecida';
      }

      if (el) el.textContent = shown;
    } catch (e) {
      if (el) el.textContent = 'Indisponível';
      console.error('carregarContaAtual:', e);
    }
  }

  async function trocarConta() {
    try {
      await fetch('/api/account/clear', { method: 'POST' });
    } catch (_) {}
    window.location.href = '/select-conta';
  }

  /* ==========================
   *  Modal de Status / Token
   * ========================== */
  function abrirModalStatus() {
    const m = $('modal-status');
    if (m) m.style.display = 'block';
  }
  function fecharModalStatus() {
    const m = $('modal-status');
    if (m) m.style.display = 'none';
  }

  async function verificarToken(updateModal = false) {
    try {
      const response = await fetch('/verificar-token');
      const data = await response.json();
      if (data.success) {
        if (updateModal) {
          $('status-usuario').textContent = data.nickname || '—';
          $('status-token').textContent = data.token_preview || '—';
          $('status-msg').textContent = data.message || 'OK';
        } else {
          alert(
            '✅ ' +
              (data.message || 'OK') +
              '\nUser: ' +
              (data.nickname || '—') +
              '\nToken: ' +
              (data.token_preview || '—'),
          );
        }
      } else {
        const msg = data.error || 'Falha ao verificar';
        if (updateModal) $('status-msg').textContent = msg;
        else alert('❌ ' + msg);
      }
    } catch (error) {
      const msg = 'Erro: ' + error.message;
      if (updateModal) $('status-msg').textContent = msg;
      else alert('❌ ' + msg);
    }
  }

  async function renovarToken(updateModal = false) {
    try {
      const response = await fetch('/renovar-token-automatico', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        if (updateModal) {
          $('status-usuario').textContent = data.nickname || '—';
          $('status-token').textContent =
            (data.access_token || '').substring(0, 20) + '...';
          $('status-msg').textContent =
            data.message || 'Token renovado com sucesso';
        } else {
          alert(
            '✅ ' +
              (data.message || 'Token renovado') +
              '\nUser: ' +
              (data.nickname || '—') +
              '\nNovo token: ' +
              (data.access_token || '').substring(0, 20) +
              '...',
          );
        }
      } else {
        const msg = data.error || 'Falha ao renovar';
        if (updateModal) $('status-msg').textContent = msg;
        else alert('❌ ' + msg);
      }
    } catch (error) {
      const msg = 'Erro: ' + error.message;
      if (updateModal) $('status-msg').textContent = msg;
      else alert('❌ ' + msg);
    }
  }

  /* ==========================
   *  Dimensões – helpers
   * ========================== */

  function parseDimensions(dimStr) {
    if (!dimStr || typeof dimStr !== 'string') {
      return {
        height_cm: '',
        width_cm: '',
        length_cm: '',
        weight_g: '',
      };
    }

    const [dimsPart, weightPart] = dimStr.split(',');
    const dims = (dimsPart || '')
      .split('x')
      .map((p) => p.trim())
      .map((p) => Number(p.replace(',', '.')) || '');

    const [h, w, l] = dims;
    const weight = weightPart ? Number(weightPart.replace(',', '.')) || '' : '';

    return {
      height_cm: h,
      width_cm: w,
      length_cm: l,
      weight_g: weight,
    };
  }

async function fetchDimensoes(mlb) {
  try {
    const res = await fetch('/api/validar-dimensoes/analisar-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mlb }),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || j.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || json.message || 'Falha na análise');
    }

    const d = json.data || {};
    return {
      mlb: d.mlb || mlb,
      raw: d.raw || '',
      error: d.status === 'ERRO' ? d.message || 'Erro ao buscar dimensões' : null,
    };
  } catch (err) {
    console.error('Erro ao buscar dimensões', mlb, err);
    return {
      mlb,
      raw: '',
      error: err.message || 'Erro ao buscar dimensões',
    };
  }
}


  function renderTabela() {
    const tbody = $('dim-results-body');
    const btnDownload = $('btn-dim-download');
    if (!tbody || !btnDownload) return;

    if (!resultados.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:#6b7280;">Sem resultados ainda</td></tr>';
      btnDownload.disabled = true;
      return;
    }

    const rowsHtml = resultados
      .map((r, idx) => {
        const dims = parseDimensions(r.raw);
        const status = r.error ? `Erro: ${r.error}` : 'OK';

        return `
          <tr>
            <td>${idx + 1}</td>
            <td class="mono">${r.mlb}</td>
            <td>${dims.height_cm}</td>
            <td>${dims.width_cm}</td>
            <td>${dims.length_cm}</td>
            <td>${dims.weight_g}</td>
            <td>${r.raw || ''}</td>
            <td>${status}</td>
          </tr>
        `;
      })
      .join('');

    tbody.innerHTML = rowsHtml;
    btnDownload.disabled = false;
  }

  function atualizarProgresso(atual, total) {
    const txt = $('dim-progress-text');
    const bar = $('dim-progress-bar');
    if (txt) txt.textContent = `${atual} / ${total}`;
    if (bar) {
      const pct = total > 0 ? (atual / total) * 100 : 0;
      bar.style.width = `${pct}%`;
    }
  }

  async function processarLote(mlbs) {
    resultados = [];
    renderTabela();
    atualizarProgresso(0, mlbs.length);

    const delayInput = $('dim-delay-ms');
    const intervaloMs = Number(delayInput?.value || 0);

    let atual = 0;
    for (const mlb of mlbs) {
      const r = await fetchDimensoes(mlb);
      resultados.push(r);
      renderTabela();

      atual += 1;
      atualizarProgresso(atual, mlbs.length);

      if (intervaloMs > 0 && atual < mlbs.length) {
        await new Promise((resolve) => setTimeout(resolve, intervaloMs));
      }
    }
  }

  function exportarCSV() {
    if (!resultados.length) return;

    const header = [
      'MLB',
      'Altura_cm',
      'Largura_cm',
      'Comprimento_cm',
      'Peso_g',
      'Bruto_shipping_dimensions',
      'Status',
    ];

    const linhas = resultados.map((r) => {
      const dims = parseDimensions(r.raw);
      const status = r.error ? `Erro: ${r.error}` : 'OK';

      const cols = [
        r.mlb,
        dims.height_cm,
        dims.width_cm,
        dims.length_cm,
        dims.weight_g,
        r.raw || '',
        status,
      ];

      return cols
        .map((v) => {
          const s = String(v ?? '');
          if (s.includes(';') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(';');
    });

    const conteudo = [header.join(';'), ...linhas].join('\n');
    const blob = new Blob([conteudo], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dimensoes-mlb-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ==========================
   *  Eventos / Boot
   * ========================== */

  function bindEvents() {
    const btnUm = $('btn-dim-analisar-um');
    const inputUm = $('dim-mlb-single');
    const btnLote = $('btn-dim-analisar-lote');
    const txtLote = $('dim-mlb-bulk');
    const btnDownload = $('btn-dim-download');

    if (btnUm && inputUm) {
      btnUm.addEventListener('click', async () => {
        const mlb = (inputUm.value || '').trim();
        if (!mlb) return;
        resultados = [];
        atualizarProgresso(0, 1);
        const r = await fetchDimensoes(mlb);
        resultados.push(r);
        renderTabela();
        atualizarProgresso(1, 1);
      });
    }

    if (btnLote && txtLote) {
      btnLote.addEventListener('click', async () => {
        const linhas = (txtLote.value || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (!linhas.length) return;
        await processarLote(linhas);
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', exportarCSV);
    }

    const btnStatus = $('btn-status');
    if (btnStatus) {
      btnStatus.addEventListener('click', async () => {
        abrirModalStatus();
        await verificarToken(true);
      });
    }

    const btnSwitch = $('account-switch');
    if (btnSwitch) {
      btnSwitch.addEventListener('click', trocarConta);
    }

    // botões do modal
    qsa('[data-action="verificar-token"]').forEach((el) =>
      el.addEventListener('click', () => verificarToken(true)),
    );
    qsa('[data-action="renovar-token"]').forEach((el) =>
      el.addEventListener('click', () => renovarToken(true)),
    );
    qsa('[data-close-modal="status"]').forEach((el) =>
      el.addEventListener('click', fecharModalStatus),
    );

    // fechar modal clicando fora
    window.addEventListener('click', (ev) => {
      const modal = $('modal-status');
      if (ev.target === modal) fecharModalStatus();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    carregarContaAtual();
    bindEvents();
  });
})();
