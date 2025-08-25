// public/js/pesquisa-descricao.js  (v4)
// Agora com barra de progresso interpolada (1% em 1%) e animações.
// ---------------------------------------------------------------

// ===== Variáveis globais =====
let modoProcessamentoSelecionado = null;
let intervalMonitoramento = null;
let currentJobId = null;          // usado em download de resultados
let cacheJobs = [];               // lista de jobs para filtros

// estado de progresso por job (para interpolar %)
const jobProgressState = {};      // { [jobId]: { current: number, target: number, timer: number|null } }

// ===== Utilitários DOM =====
const $ = (id) => document.getElementById(id);
const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const show = (id, on = true) => { const el = $(id); if (el) el.style.display = on ? 'block' : 'none'; };
const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

// ===== Inicialização =====
document.addEventListener('DOMContentLoaded', () => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('novo_processo') === 'true') {
    abrirModalNovoProcesso();
  }

  if ($('mlbs-rapida')) contarMLBsRapida();
  if ($('mlbs-massa'))  contarMLBsMassa();

  atualizarMonitoramento();
  iniciarMonitoramentoAutomatico();

  on('form-pesquisa-rapida', 'submit', async (e) => { if (!e.target) return; e.preventDefault(); await executarPesquisaRapida(); });
  on('form-processamento-massa', 'submit', async (e) => { if (!e.target) return; e.preventDefault(); await executarProcessamentoMassa(); });

  on('tipo-modal', 'change', function () {
    const grupo = $('grupo-texto-modal');
    if (grupo) grupo.style.display = (this.value === 'pesquisar_texto') ? 'block' : 'none';
  });
});

// ===== Abas =====
function abrirTab(tabId) {
  const allTabs = document.querySelectorAll('.tab-content');
  if (allTabs && allTabs.length) {
    allTabs.forEach(t => t.classList.remove('active'));
    const chosen = $(tabId);
    if (chosen) chosen.classList.add('active');
  }
  if (tabId === 'monitoramento') {
    atualizarMonitoramento();
    iniciarMonitoramentoAutomatico();
  } else {
    pararMonitoramentoAutomatico();
  }
}

// ====== Pesquisa Rápida (opcional) ======
function alterarTipoPesquisaRapida() {
  const tipo = $('tipo-pesquisa-rapida')?.value;
  const grupo = $('grupo-texto-rapida');
  if (!grupo) return;
  if (tipo === 'pesquisar_texto') {
    grupo.style.display = 'block';
    const txt = $('texto-pesquisa-rapida'); if (txt) txt.required = true;
  } else {
    grupo.style.display = 'none';
    const txt = $('texto-pesquisa-rapida'); if (txt) txt.required = false;
  }
}

function contarMLBsRapida() {
  const campo = $('mlbs-rapida');
  if (!campo) return;
  const resultado = contarMLBs(campo.value);
  text('total-mlbs-rapida', resultado.total);
  text('validos-mlbs-rapida', resultado.validos);
  text('invalidos-mlbs-rapida', resultado.invalidos);

  const status = $('status-limite-rapida');
  if (status) {
    if (resultado.total > 50) {
      status.textContent = 'Excede limite! Use Processamento em Massa';
      status.style.background = '#dc3545'; status.style.color = '#fff';
    } else {
      status.textContent = 'Limite: 50 MLBs';
      status.style.background = '#e9ecef'; status.style.color = '#495057';
    }
  }
}

function limparFormularioRapida() {
  const form = $('form-pesquisa-rapida');
  if (form) form.reset();
  const grupo = $('grupo-texto-rapida'); if (grupo) grupo.style.display = 'none';
  contarMLBsRapida();
  fecharResultados();
}

// ===== Processamento em Massa =====
function selecionarModo(modo) {
  document.querySelectorAll('.processing-mode').forEach(el => el.classList.remove('selected'));
  const box = $('modo-' + modo);
  if (box) box.classList.add('selected');
  modoProcessamentoSelecionado = modo;
  atualizarModoProcessamento();
}

function atualizarModoProcessamento() {
  const total = parseInt(($('total-mlbs-massa')?.textContent || '0'), 10);
  const statusEl = $('status-processamento-massa');
  const forcar = $('forcar-background-massa')?.checked;

  let modo = 'Não Selecionado';
  let cor  = '#6c757d';

  if (forcar || total > 100) {
    modo = 'Background'; cor = '#667eea';
    selecionarModo('background');
  } else if (modoProcessamentoSelecionado === 'direto' || (total > 0 && total <= 100)) {
    modo = 'Direto'; cor = '#28a745';
    if (!modoProcessamentoSelecionado) selecionarModo('direto');
  }

  if (statusEl) {
    statusEl.textContent = `Modo: ${modo}`;
    statusEl.style.background = cor;
    statusEl.style.color = '#fff';
  }
}

function alterarTipoPesquisaMassa() {
  const tipo = $('tipo-pesquisa-massa')?.value;
  const grupo = $('grupo-texto-massa');
  if (!grupo) return;
  if (tipo === 'pesquisar_texto') {
    grupo.style.display = 'block';
    const txt = $('texto-pesquisa-massa'); if (txt) txt.required = true;
  } else {
    grupo.style.display = 'none';
    const txt = $('texto-pesquisa-massa'); if (txt) txt.required = false;
  }
}

function contarMLBsMassa() {
  const campo = $('mlbs-massa');
  if (!campo) return;
  const resultado = contarMLBs(campo.value);
  text('total-mlbs-massa', resultado.total);
  text('validos-mlbs-massa', resultado.validos);
  text('invalidos-mlbs-massa', resultado.invalidos);

  // 2s por MLB -> minutos
  const minutos = Math.ceil((resultado.validos * 2) / 60);
  text('tempo-estimado-massa', minutos);
  atualizarModoProcessamento();
}

function limparFormularioMassa() {
  const form = $('form-processamento-massa');
  if (form) form.reset();
  const grupo = $('grupo-texto-massa'); if (grupo) grupo.style.display = 'none';
  document.querySelectorAll('.processing-mode').forEach(el => el.classList.remove('selected'));
  modoProcessamentoSelecionado = null;
  contarMLBsMassa();
  fecharResultados();
}

async function validarMLBsMassa() {
  const txt = $('mlbs-massa')?.value || '';
  if (!txt.trim()) return alert('❌ Digite alguns MLBs para validar');
  const mlbs = extrairMLBs(txt);
  if (!mlbs.length) return alert('❌ Nenhum MLB válido encontrado');

  const r = contarMLBs(txt);
  alert(`✅ Validação concluída:\n\n📊 Total encontrados: ${r.total}\n✅ Válidos: ${r.validos}\n❌ Inválidos: ${r.invalidos}\n⏱️ Tempo estimado: ${Math.ceil((r.validos * 2)/60)} minutos`);
}

// ===== Submissões =====
async function executarPesquisaRapida() {
  const tipo = $('tipo-pesquisa-rapida')?.value;
  const texto = $('texto-pesquisa-rapida')?.value || '';
  const mlbsTexto = $('mlbs-rapida')?.value || '';

  if (!tipo || !mlbsTexto.trim()) return alert('❌ Preencha todos os campos obrigatórios');
  const mlbs = extrairMLBs(mlbsTexto);
  if (!mlbs.length) return alert('❌ Nenhum MLB válido encontrado');
  if (mlbs.length > 50) return alert('❌ Muitos MLBs para pesquisa rápida. Use o Processamento em Massa.');

  const btn = $('btn-pesquisar-rapida');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<div class="spinner"></div> Iniciando...'; btn.disabled = true; }

  try {
    const payload = { consultas: mlbs, opcoes: { tipo_processamento: tipo, texto: (tipo === 'pesquisar_texto' ? texto : undefined), forca_background: true } };
    const resp = await fetch('/api/pesquisa-descricao/enfileirar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.ok || data.success) {
      alert(`🚀 Pesquisa iniciada!\nJob ID: ${data.job_id}\nTotal MLBs: ${mlbs.length}\nAcompanhe na seção Monitoramento.`);
      atualizarMonitoramento();
    } else {
      alert('❌ Erro: ' + (data.message || data.error));
    }
  } catch (e) {
    alert('❌ Erro na pesquisa: ' + e.message);
  } finally {
    if (btn) { btn.innerHTML = original; btn.disabled = false; }
  }
}

async function executarProcessamentoMassa() {
  const tipo = $('tipo-pesquisa-massa')?.value;
  const texto = $('texto-pesquisa-massa')?.value || '';
  const mlbsTexto = $('mlbs-massa')?.value || '';

  if (!tipo || !mlbsTexto.trim()) return alert('❌ Preencha todos os campos obrigatórios');
  if (!modoProcessamentoSelecionado) return alert('❌ Selecione um modo de processamento');

  const mlbs = extrairMLBs(mlbsTexto);
  if (!mlbs.length) return alert('❌ Nenhum MLB válido encontrado');

  const btn = $('btn-processar-massa');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<div class="spinner"></div> Iniciando...'; btn.disabled = true; }

  try {
    const payload = { consultas: mlbs, opcoes: { tipo_processamento: tipo, texto: (tipo === 'pesquisar_texto' ? texto : undefined), forca_background: true } };
    const resp = await fetch('/api/pesquisa-descricao/enfileirar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.ok || data.success) {
      alert(`🚀 Processamento iniciado!\nJob ID: ${data.job_id}\nTotal MLBs: ${mlbs.length}`);
      atualizarMonitoramento();
    } else {
      alert('❌ Erro: ' + (data.message || data.error));
    }
  } catch (e) {
    alert('❌ Erro no processamento: ' + e.message);
  } finally {
    if (btn) { btn.innerHTML = original; btn.disabled = false; }
  }
}

// ===== Monitoramento =====
function iniciarMonitoramentoAutomatico() {
  pararMonitoramentoAutomatico();
  intervalMonitoramento = setInterval(atualizarMonitoramento, 5000);
}
function pararMonitoramentoAutomatico() {
  if (intervalMonitoramento) clearInterval(intervalMonitoramento);
  intervalMonitoramento = null;
}

async function atualizarMonitoramento() {
  try {
    // Stats
    const st = await fetch('/api/pesquisa-descricao/status?_=' + Date.now(), { cache: 'no-store' });
    const stData = await st.json();
    if (stData.ok || stData.success) {
      const s = stData.stats || {};
      text('stat-processando', s.processando_agora || 0);
      text('stat-aguardando',  s.fila_aguardando   || 0);
      text('stat-concluidos',  s.concluidos_recentes|| 0);
      text('stat-erros',       s.falharam_recentes || 0);
    }

    // Jobs
    const jb = await fetch('/api/pesquisa-descricao/jobs?_=' + Date.now(), { cache: 'no-store' });
    const jbData = await jb.json();

    if (jbData.ok && Array.isArray(jbData.jobs)) {
      cacheJobs = jbData.jobs;
      aplicarFiltrosEExibir();
    } else {
      cacheJobs = [];
      aplicarFiltrosEExibir();
    }
  } catch (err) {
    const c = $('lista-processos-monitor');
    if (c) c.innerHTML = `<div class="alert alert-danger"><strong>❌ Erro:</strong> ${err.message}</div>`;
  }
}

function aplicarFiltrosEExibir() {
  const container = $('lista-processos-monitor');
  if (!container) return;

  const filtroStatus = $('filtro-status-monitor')?.value || '';
  const limite = parseInt(($('filtro-limite-monitor')?.value || '20'), 10);

  let lista = Array.from(cacheJobs || []);
  if (filtroStatus) {
    lista = lista.filter(j => (j.status || '').toLowerCase() === filtroStatus.toLowerCase());
  }
  if (Number.isFinite(limite)) lista = lista.slice(0, limite);

  if (!lista.length) {
    container.innerHTML = `<p>📭 Nenhum processo encontrado</p>`;
    return;
  }

  // Render cards com estrutura de progresso animado
  container.innerHTML = lista.map(job => renderJobCard(job)).join('');

  // Inicializa barras (ou atualiza alvos) após render
  lista.forEach(job => initOrUpdateProgress(job));
}

function renderJobCard(job) {
  const id     = job.id || job.job_id || job.jobId || '';
  const status = (job.status || 'aguardando').toLowerCase();
  const total  = job.total_mlbs ?? job.total ?? 0;
  const done   = job.total_processados ?? job.processados ?? 0;
  const found  = job.total_encontrados ?? job.encontrados ?? 0;

  const map = {
    processando: { txt:'Processando', cor:'#ffc107', icon:'⚡' },
    aguardando:  { txt:'Na Fila',     cor:'#6c757d', icon:'⏳' },
    concluido:   { txt:'Concluído',   cor:'#28a745', icon:'✅' },
    cancelado:   { txt:'Cancelado',   cor:'#dc3545', icon:'❌' },
    erro:        { txt:'Com Erro',    cor:'#dc3545', icon:'⚠️' }
  };
  const s = map[status] || map.aguardando;

  // alvo de progresso que veio da API
  let target = job.progresso_percentual ?? job.progress ?? 0;
  if (status === 'concluido') target = 100;
  target = Math.max(0, Math.min(100, Math.round(target)));

  return `
    <div class="job-card" data-job-id="${id}" data-status="${status}" data-total="${total}" data-done="${done}">
      <div class="header">
        <span>${s.icon}</span>
        <strong>${s.txt}</strong>
        <small>${id}</small>
      </div>

      <div class="stats">
        <div>${total} Total</div>
        <div class="done">${done} Process.</div>
        <div>${found} Encontrados</div>
        <div class="alvo" data-target="${target}">${target}% Progr.</div>
      </div>

      <div class="progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:0%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
          <div class="progress-shine"></div>
        </div>
        <div class="progress-meta">
          <span class="percent">0%</span>
          <span class="counts"><span class="count-done">${done}</span> / <span class="count-total">${total}</span></span>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick="verDetalhesJob('${id}')">Detalhes</button>
        ${status==='concluido' ? `<a href="/api/pesquisa-descricao/download/${id}" class="btn btn-success">Download Resultados</a>` : ''}
      </div>
    </div>
  `;
}

// ===== Barra de progresso interpolada =====
function initOrUpdateProgress(job) {
  const id = job.id || job.job_id || job.jobId || '';
  if (!id) return;

  const card = document.querySelector(`.job-card[data-job-id="${CSS.escape(id)}"]`);
  if (!card) return;

  const targetEl = card.querySelector('.alvo');
  const target = targetEl ? parseInt(targetEl.getAttribute('data-target'), 10) || 0 : 0;

  if (!jobProgressState[id]) {
    jobProgressState[id] = { current: 0, target, timer: null };
  } else {
    jobProgressState[id].target = target;
  }

  // atualiza contadores
  const total = parseInt(card.getAttribute('data-total') || '0', 10);
  const done = parseInt(card.getAttribute('data-done') || '0', 10);
  const doneEl = card.querySelector('.count-done');
  const totalEl = card.querySelector('.count-total');
  if (doneEl) doneEl.textContent = done;
  if (totalEl) totalEl.textContent = total;

  // inicia loop de incremento se não houver
  if (!jobProgressState[id].timer) {
    jobProgressState[id].timer = setInterval(() => stepProgress(id), 50); // 1% a cada 50ms
  }

  // se já concluído, força 100% e encerra
  if ((job.status || '').toLowerCase() === 'concluido' || target >= 100) {
    jobProgressState[id].target = 100;
  }
}

function stepProgress(id) {
  const state = jobProgressState[id];
  if (!state) return;

  const card = document.querySelector(`.job-card[data-job-id="${CSS.escape(id)}"]`);
  if (!card) { clearInterval(state.timer); state.timer = null; return; }

  const bar = card.querySelector('.progress-fill');
  const percentEl = card.querySelector('.percent');

  // aproxima de 1 em 1 até o alvo
  if (state.current < state.target) state.current += 1;
  if (state.current > state.target) state.current = state.target;

  bar.style.width = `${state.current}%`;
  bar.setAttribute('aria-valuenow', String(state.current));
  if (percentEl) percentEl.textContent = `${state.current}%`;

  // concluiu?
  if (state.current >= 100) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

// ===== Detalhes / Resultados (sem mudanças funcionais) =====
async function verDetalhesJob(jobId) {
  const modal = $('modal-detalhes-job');
  const content = $('detalhes-job-content');
  if (!modal || !content) return;
  content.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando...</div>`;
  modal.style.display = 'block';

  try {
    const resp = await fetch('/api/pesquisa-descricao/jobs?_=' + Date.now(), { cache:'no-store' });
    const data = await resp.json();
    if (!data.ok) throw new Error('Falha ao obter lista de jobs');

    const job = (data.jobs || []).find(j => (j.id===jobId || j.job_id===jobId || j.jobId===jobId));
    if (!job) throw new Error(`Job ${jobId} não encontrado`);

    const total = job.total_mlbs ?? 0;
    const done  = job.total_processados ?? 0;
    const found = job.total_encontrados ?? 0;
    const fail  = job.falharam ?? 0;
    const prog  = job.progresso_percentual ?? 0;
    const tempo = job.tempo_decorrido ?? 'N/A';

    content.innerHTML = `
      <h4>📦 Detalhes do Job</h4>
      <p><strong>ID:</strong> ${jobId}</p>
      <p><strong>Status:</strong> ${job.status}</p>
      <p><strong>Total MLBs:</strong> ${total}</p>
      <p><strong>Processados:</strong> ${done}</p>
      <p><strong>Encontrados:</strong> ${found}</p>
      <p><strong>Falharam:</strong> ${fail}</p>
      <p><strong>Progresso:</strong> ${prog}%</p>
      <p><strong>Tempo:</strong> ${tempo}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/api/pesquisa-descricao/download/${jobId}?formato=txt" class="btn btn-success">📥 Download (.txt)</a>
        <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-outline">JSONL</a>
        <button class="btn btn-secondary" onclick="fecharModalDetalhes()">Fechar</button>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-danger">❌ ${err.message}</div>`;
  }
}

function fecharModalDetalhes() {
  const modal = $('modal-detalhes-job');
  if (modal) modal.style.display = 'none';
}

async function verResultados(jobId) {
  currentJobId = jobId;
  try {
    const resp = await fetch(`/api/pesquisa-descricao/jobs/${jobId}?_=` + Date.now(), { cache:'no-store' });
    const jobData = await resp.json();

    const totalMLBs  = jobData.total_mlbs || jobData.total || 1;
    const processados = jobData.total_processados || jobData.processados || totalMLBs;

    let encontrados = 0;
    if (Number.isFinite(jobData.total_encontrados)) encontrados = jobData.total_encontrados;
    else if (Number.isFinite(jobData.encontrados))  encontrados = jobData.encontrados;
    if (jobData.status === 'concluido' && (!jobData.falharam || jobData.falharam === 0)) {
      encontrados = Math.max(encontrados, 0);
    }

    const taxa = processados > 0 ? Math.round((encontrados / processados) * 100) : 0;
    const tempo = jobData.tempo_decorrido || 'Alguns segundos';

    const dadosResultados = {
      total_processados: processados,
      total_encontrados: encontrados,
      tempo_processamento: tempo,
      resultados: jobData.resultados || []
    };

    exibirResultados(dadosResultados, 'detectar_dois_volumes');
  } catch (err) {
    alert('❌ Erro ao carregar resultados: ' + err.message);
  }
}

// ===== Ferramentas / Auxiliares =====
function contarMLBs(texto) {
  const mlbs = extrairMLBs(texto);
  const validos = mlbs.filter(m => /^MLB\d{9,12}$/i.test(m));
  return { total: mlbs.length, validos: validos.length, invalidos: mlbs.length - validos.length };
}
function extrairMLBs(texto) {
  if (!texto) return [];
  const matches = texto.match(/MLB\d{9,12}/gi) || [];
  return [...new Set(matches.map(m => m.toUpperCase()))];
}

function exibirResultados(data) {
  const container = $('results-container');
  const stats = $('results-stats');
  const content = $('results-content');
  if (!container || !stats || !content) return;

  const proc = data.total_processados || 0;
  const found = data.total_encontrados || 0;
  const taxa  = proc > 0 ? Math.round((found / proc) * 100) : 0;

  stats.innerHTML = `
    <div class="stat-card"><div class="stat-number">${proc}</div><div class="stat-label">Total Processados</div></div>
    <div class="stat-card"><div class="stat-number">${found}</div><div class="stat-label">Encontrados</div></div>
    <div class="stat-card"><div class="stat-number">${data.tempo_processamento || 'N/A'}</div><div class="stat-label">Tempo</div></div>
    <div class="stat-card"><div class="stat-number">${taxa}%</div><div class="stat-label">Taxa de Sucesso</div></div>
  `;

  if (Array.isArray(data.resultados) && data.resultados.length) {
    content.innerHTML = `
      <div style="max-height:400px;overflow-y:auto;">
        ${data.resultados.map(r => `
          <div style="background:#fff;margin:10px 0;padding:15px;border-radius:8px;border-left:4px solid ${r.encontrado ? '#28a745' : '#6c757d'};">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>${r.mlb_id || '-'}</strong>
              <span style="background:${r.encontrado?'#d4edda':'#e2e3e5'};color:${r.encontrado?'#155724':'#383d41'};padding:3px 8px;border-radius:12px;font-size:12px;">
                ${r.encontrado ? '✅ Encontrado' : '❌ Não encontrado'}
              </span>
            </div>
            ${r.titulo ? `<div style="margin:5px 0;color:#666;">${r.titulo}</div>` : ''}
            ${r.detalhes ? `<div style="margin:5px 0;font-size:14px;">${r.detalhes}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  } else {
    content.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div style="background:#d4edda;border:1px solid #28a745;border-radius:8px;padding:20px;margin:20px 0;">
          <h4 style="color:#28a745;margin:0 0 10px 0;">✅ Processamento Concluído!</h4>
          <p style="margin:0;color:#155724;">${found} produtos encontrados de ${proc} processados</p>
        </div>
        <div style="margin-top:30px;">
          <p style="color:#666;margin-bottom:20px;">📋 Para ver os resultados detalhados, faça o download do arquivo.</p>
          <button class="btn btn-success" onclick="window.location.href='/api/pesquisa-descricao/download/'+(window.currentJobId||'')+'?formato=txt'">📥 Download Resultados Completos</button>
        </div>
      </div>
    `;
  }

  container.style.display = 'block';
  container.scrollIntoView({ behavior: 'smooth' });
}

function fecharResultados() {
  const container = $('results-container');
  if (container) container.style.display = 'none';
}

function exportarResultados() { alert('🚧 Funcionalidade de exportação em desenvolvimento'); }

// ===== Controles do sistema =====
async function controlarSistema(acao) {
  try {
    const endpoint = (acao === 'pausar') ? '/api/pesquisa-descricao/pausar' : '/api/pesquisa-descricao/retomar';
    const resp = await fetch(endpoint, { method: 'POST' });
    const data = await resp.json();
    if (data.ok || data.success) {
      alert(`✅ Sistema ${acao === 'pausar' ? 'pausado' : 'retomado'} com sucesso.`);
      atualizarMonitoramento();
    } else {
      alert('❌ Erro: ' + (data.message || 'Ação não disponível'));
    }
  } catch (err) {
    alert('❌ Erro: ' + err.message);
  }
}

// ===== Modais =====
function abrirModalNovoProcesso() {
  const m = $('modal-novo-processo');
  if (m) m.style.display = 'block';
}
function fecharModalNovoProcesso() {
  const m = $('modal-novo-processo');
  if (m) m.style.display = 'none';
  const f = $('form-modal-processo'); if (f) f.reset();
  const g = $('grupo-texto-modal'); if (g) g.style.display = 'none';
}
async function iniciarProcessoModal() {
  const tipo = $('tipo-modal')?.value;
  const texto = $('texto-modal')?.value || '';
  const mlbsTexto = $('mlbs-modal')?.value || '';

  if (!tipo || !mlbsTexto.trim()) return alert('❌ Preencha todos os campos obrigatórios');

  const mlbs = extrairMLBs(mlbsTexto);
  if (!mlbs.length) return alert('❌ Nenhum MLB válido encontrado');

  try {
    const payload = { consultas: mlbs, opcoes: { tipo_processamento: tipo, texto: (tipo === 'pesquisar_texto' ? texto : undefined) } };
    const resp = await fetch('/api/pesquisa-descricao/enfileirar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await resp.json();

    if (data.ok || data.success) {
      alert(`✅ Processo iniciado!\nJob ID: ${data.job_id || data.id}\nTotal MLBs: ${mlbs.length}`);
      fecharModalNovoProcesso();
      atualizarMonitoramento();
    } else {
      alert('❌ Erro: ' + (data.message || data.error));
    }
  } catch (err) {
    alert('❌ Erro: ' + err.message);
  }
}

// ===== Fechamento automático de modal ao clicar fora =====
window.addEventListener('click', (ev) => {
  document.querySelectorAll('.modal').forEach(modal => {
    if (ev.target === modal) modal.style.display = 'none';
  });
});

// ===== Limpeza ao sair =====
window.addEventListener('beforeunload', () => pararMonitoramentoAutomatico());
