// public/js/criar-promocao.js
// Deixa as funções no escopo global:
window.aplicarUnico = aplicarUnico;
window.aplicarLote = aplicarLote;
window.limparUnico  = limparUnico;

async function aplicarUnico() {
  const mlb = document.getElementById('mlbUnico').value.trim();
  const percent = Number(document.getElementById('percent').value);
  if (!mlb) return alert('Informe o MLB.');
  if (!percent || percent <= 0) return alert('Informe um percentual válido.');

  try {
    const r = await fetch('/api/criar-promocao/desconto/unico', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mlb, percent })
    });
    const data = await r.json();
    if (data.success) {
      alert(`✅ Sucesso!\nMLB: ${data.mlb_id}\nPercent: ${data.applied_percent}%\nNovo preço: ${data.deal_price}`);
      appendResult(data);
    } else {
      alert('❌ ' + (data.error || 'Falha ao aplicar desconto'));
      appendResult(data);
    }
  } catch (e) {
    alert('❌ Erro: ' + e.message);
  }
}

async function aplicarLote() {
  const mlbs = document.getElementById('mlbsLista').value;
  const percent = Number(document.getElementById('percent').value);
  const delay_ms = Number(document.getElementById('delayMs').value) || 0;
  if (!mlbs.trim()) return alert('Informe os MLBs (um por linha).');
  if (!percent || percent <= 0) return alert('Informe um percentual válido.');

  resetProgress();

  try {
    const r = await fetch('/api/criar-promocao/desconto/lote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mlbs, percent, delay_ms })
    });
    const data = await r.json();
    if (!(data && data.success)) {
      return alert('❌ ' + (data.error || 'Falha ao iniciar processo'));
    }
    const jobId = data.job_id;
    pollStatus(jobId);
  } catch (e) {
    alert('❌ Erro: ' + e.message);
  }
}

function resetProgress() {
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = 'Aguardando…';
  document.getElementById('downloadLink').style.display = 'none';
  document.getElementById('downloadLink').removeAttribute('href');
  document.getElementById('results').textContent = 'Sem resultados ainda.';
}

async function pollStatus(jobId) {
  const url = `/api/criar-promocao/status/${jobId}`;
  const resEl = document.getElementById('results');
  const bar = document.getElementById('progressFill');
  const txt = document.getElementById('progressText');
  const dl = document.getElementById('downloadLink');

  const interval = setInterval(async () => {
    try {
      const r = await fetch(url, { cache:'no-store' });
      const data = await r.json();
      if (!data.success) return;

      const pct = data.progresso_percentual || 0;
      bar.style.width = `${pct}%`;
      txt.textContent = `${pct}% • ${data.processados || 0}/${data.total || 0} processados`;

      if (data.status === 'concluido') {
        clearInterval(interval);
        txt.textContent = `Concluído • ${data.ok || 0} OK, ${data.fail || 0} erros`;
        resEl.textContent = JSON.stringify(data.results, null, 2);
        dl.href = `/api/criar-promocao/download/${jobId}`;
        dl.style.display = 'inline-block';
      }
    } catch (e) {
      console.error('poll error', e);
    }
  }, 1000);
}

function appendResult(obj) {
  const resEl = document.getElementById('results');
  let curr;
  try { curr = JSON.parse(resEl.textContent); } catch { curr = []; }
  if (!Array.isArray(curr)) curr = [];
  curr.push(obj);
  resEl.textContent = JSON.stringify(curr, null, 2);
}

function limparUnico() {
  document.getElementById('mlbUnico').value = '';
}
