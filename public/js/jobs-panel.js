/* Painel de processos – sempre visível; lembra estado (minimizado) via localStorage
   Suporta "badges" (pills) por conta:
     - badge/badges: { text, cls }
     - OU accountKey/accountLabel (mapeado para badge automaticamente)
   Agora também expõe:
     - JobsPanel.mergeApiJobs(list)  -> mescla jobs vindos do backend
     - PromoJobs shim:
         .noteLocalJobStart(title, {accountKey, accountLabel, badges})
         .linkLocalToServer(localId, serverId)
         .tick(id, progress?, state?)
*/
(function () {
  const PANEL_SEL = '#bulkJobsPanel';
  const JOBS_KEY  = '__jobs_panel_v2__';
  const UI_KEY    = '__jobs_panel_ui__';  // guarda { collapsed: bool }
  const JOB_TTL   = 24 * 60 * 60 * 1000;  // 24h

  // map de contas -> classes/labels (pills)
  const ACCOUNT_BADGE_CLS = {
    drossi:     'badge-drossi',
    diplany:    'badge-diplany',
    rossidecor: 'badge-rossidecor',
  };
  const ACCOUNT_LABELS = {
    drossi:     'DRossi Interiores',
    diplany:    'Diplany',
    rossidecor: 'Rossi Decor',
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    s == null
      ? ''
      : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let panel = null;
  function ensurePanel() { if (!panel) panel = $(PANEL_SEL); return panel; }

  /* ============================ UI state (minimizado) ============================ */
  let ui = { collapsed: false };
  function loadUI(){
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || '{"collapsed":false}'); }
    catch { ui = { collapsed:false }; }
    if (typeof ui.collapsed !== 'boolean') ui.collapsed = false;
  }
  function saveUI(){
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
  }

  /* ================================ jobs store ================================== */
  let cache = null;
  function load() {
    try { cache = JSON.parse(localStorage.getItem(JOBS_KEY) || '{}'); }
    catch { cache = {}; }
    cleanup();
  }
  function save() { localStorage.setItem(JOBS_KEY, JSON.stringify(cache || {})); }
  function loadIfNeeded(){ if (!cache) load(); }
  function cleanup() {
    const now = Date.now();
    for (const id in cache) {
      const j = cache[id];
      if (!j) continue;
      if (j.dismissed || (now - (j.updated || 0)) > JOB_TTL) delete cache[id];
    }
  }

  /* ================================= helpers ==================================== */
  function clampPct(n){
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function buildAccountBadge(accountKey, accountLabel){
    if (!accountKey && !accountLabel) return null;
    const key = (accountKey || '').toLowerCase();
    const text = accountLabel || ACCOUNT_LABELS[key] || String(accountKey || '');
    const cls  = ACCOUNT_BADGE_CLS[key] || 'badge-generic';
    return { text, cls };
  }

  function normalizeBadges(badges, badge, accountKey, accountLabel){
    const arr = [];
    // 1) badge único explícito
    if (badge && (badge.text || badge.cls)) arr.push({ text:String(badge.text||''), cls:String(badge.cls||'') });
    // 2) lista explícita
    (Array.isArray(badges) ? badges : []).forEach(b=>{
      if (!b) return;
      arr.push({ text:String(b.text||''), cls:String(b.cls||'') });
    });
    // 3) se nada veio e houver contexto de conta, cria uma pill por conta
    if (!arr.length) {
      const acc = buildAccountBadge(accountKey, accountLabel);
      if (acc) arr.push(acc);
    }
    return arr;
  }

  function renderBadges(arr){
    if (!arr || !arr.length) return '';
    return ' ' + arr.map(b=>`<span class="job-badge ${esc(b.cls||'')}">${esc(b.text||'')}</span>`).join(' ');
  }

  function guessCompleted(progress, state){
    const pct = clampPct(progress);
    const st  = String(state || '');
    return pct >= 100 || /conclu/i.test(st) || /complete/i.test(st) || /finished/i.test(st);
  }

  // Extrai "a/b" do state (ex.: "processando 7/51")
  function parsePairFromState(state){
    const s = String(state || '');
    const m = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
    return { a, b };
  }

  // Normaliza progress/estado usando contadores acumulados com expected_total
  function normalizeProgressAndState(j){
    const state = j.state || '';
    const pair = parsePairFromState(state);
    const meta = j.meta || (j.meta = { expected: null, pageDone: 0, lastPair: null, maxDen: 0 });

    // expected_total "vence" qualquer outra estimativa
    if (Number.isFinite(j.expected_total) && j.expected_total > 0) {
      meta.expected = Math.max(Number(j.expected_total), meta.expected || 0);
    }

    // mantém o maior denominador já visto (caso backend varie de 7/7 → 20/20 → 51/51)
    if (pair) {
      meta.maxDen = Math.max(meta.maxDen || 0, pair.b);
      if (!meta.expected) meta.expected = meta.maxDen;
      // Detecta reset (nova página): numerador menor e denominador não cresce
      if (meta.lastPair && pair.a < meta.lastPair.a && pair.b <= meta.lastPair.b) {
        meta.pageDone += meta.lastPair.a;         // acumula o que já foi concluído no lote anterior
      }
      meta.lastPair = pair;
    }

    const expected = Number(meta.expected || 0) > 0 ? Number(meta.expected) : null;

    // Decide progress:
    // 1) Se houver pair + expected: usa acumulado
    // 2) Senão, se progress numérico veio do backend, mantemos
    // 3) Caso contrário, deixa como estava
    let pct = clampPct(j.progress);
    let stateLabel = state;

    if (pair && expected) {
      const done = Math.min(expected, meta.pageDone + pair.a);
      pct = clampPct((done / expected) * 100);
      // monta texto "processando done/expected"
      const hasPctInState = /(^|[^0-9])\d{1,3}\s*%/.test(state);
      const base = `processando ${done}/${expected}`;
      stateLabel = hasPctInState ? base : `${base}`;
      j.completed = (done >= expected);
    } else if (expected && Number.isFinite(j.done)) {
      // caminho alternativo: se backend enviar {done, expected_total}
      const done = Math.min(expected, Math.max(0, Number(j.done)));
      pct = clampPct((done / expected) * 100);
      const hasPctInState = /(^|[^0-9])\d{1,3}\s*%/.test(state);
      const base = `processando ${done}/${expected}`;
      stateLabel = hasPctInState ? base : `${base}`;
      j.completed = (done >= expected);
    } else {
      // sem pares nem expected → mantém state e progress que já vieram
      // evita duplicar " – 12%" se o state já contém "%"
      const hasPctInState = /(^|[^0-9])\d{1,3}\s*%/.test(state);
      if (!hasPctInState && state) stateLabel = `${state} – ${pct}%`;
    }

    j.progress = pct;
    j.state = stateLabel;
  }

  /* ================================== CRUD ====================================== */
  function addLocalJob({ id, title, badge, badges, accountKey, accountLabel, expected_total }) {
    loadIfNeeded();
    const jobId = id || `local|${Date.now()}|${Math.random().toString(36).slice(2,8)}`;
    cache[jobId] = {
      id: jobId,
      title: title || 'Processo',
      badges: normalizeBadges(badges, badge, accountKey, accountLabel),
      progress: 0,
      state: 'iniciando…',
      completed: false,
      dismissed: false,
      started: Date.now(),
      updated: Date.now(),
      expected_total: Number.isFinite(expected_total) ? Number(expected_total) : null,
      meta: { expected: Number.isFinite(expected_total) ? Number(expected_total) : null, pageDone: 0, lastPair: null, maxDen: 0 }
    };
    save(); show(); render();
    return jobId;
  }

  function updateLocalJob(id, { progress, state, completed, badges, badge, accountKey, accountLabel, expected_total, done }) {
    loadIfNeeded();
    const j = cache[id]; if (!j) return;
    if (typeof progress === 'number') j.progress = clampPct(progress);
    if (state != null) j.state = String(state);
    if (typeof completed === 'boolean') j.completed = completed;
    if (Number.isFinite(expected_total)) j.expected_total = Number(expected_total);
    if (Number.isFinite(done)) j.done = Number(done);
    if (completed == null) j.completed = guessCompleted(j.progress, j.state);
    const nb = normalizeBadges(badges, badge, accountKey, accountLabel);
    if (nb.length) j.badges = nb;
    j.updated = Date.now();

    // normaliza e re-renderiza com acumulado
    normalizeProgressAndState(j);
    save(); render();
  }

  function replaceId(oldId, newId) {
    loadIfNeeded();
    if (!cache[oldId]) return newId;
    const j = cache[oldId];
    delete cache[oldId];
    j.id = newId;
    j.updated = Date.now();
    cache[newId] = j;
    save(); render();
    return newId;
  }

  function dismiss(id) {
    loadIfNeeded();
    if (cache[id]) { cache[id].dismissed = true; save(); render(); }
  }

  function listActiveIds() {
    loadIfNeeded();
    return Object.values(cache)
      .filter(j => !j.dismissed && !j.completed && !String(j.id).startsWith('local|'))
      .map(j => j.id);
  }

  function jobsForRender() {
    loadIfNeeded();
    return Object.values(cache)
      .filter(j => !j.dismissed)
      .sort((a,b) => b.updated - a.updated);
  }

  /* ========================= API: merge jobs do backend ========================= */
  function normalizeIncomingJob(j){
    const id    = String(j.id || j.job_id || '');
    const title = j.title || 'Processo';

    // tenta extrair progresso numérico
    let pct = j.progress ?? j.pct;
    const processed = Number(j.processed ?? j.done ?? j.ok ?? NaN);
    const total     = Number(j.total ?? j.expected_total ?? NaN);

    if (!Number.isFinite(pct) && Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
      pct = Math.round((processed / total) * 100);
    }
    const progress = clampPct(pct ?? 0);

    // monta um "state" amigável se vierem contadores
    let state = j.state || j.status || '';
    const success = Number(j.success ?? j.sucessos ?? j.applied ?? NaN);
    const errors  = Number(j.errors  ?? j.fails    ?? j.erros   ?? NaN);

    // monta "processando x/y — zz%  (✓a · ⚠b)" se dados existirem
    if (Number.isFinite(processed) && Number.isFinite(total)) {
      const parts = [`processando ${processed}/${total} — ${progress}%`];
      const badges = [];
      if (Number.isFinite(success)) badges.push(`✓${success}`);
      if (Number.isFinite(errors))  badges.push(`⚠${errors}`);
      if (badges.length) parts.push(`(${badges.join(' · ')})`);
      state = parts.join('  ');
    }

    const accountKey   = j.account?.key   || j.accountKey   || null;
    const accountLabel = j.account?.label || j.accountLabel || null;
    const badges = normalizeBadges(j.badges, j.badge, accountKey, accountLabel);

    const completed = ('completed' in j)
      ? !!j.completed
      : guessCompleted(progress, state);

    return { id, title, progress, state, badges, completed };
  }

  // ✅ SISTEMA DE POLLING CONTROLADO
  let pollInterval = null;
  let pollErrorCount = 0;
  let lastPollTime = 0;
  const POLL_INTERVAL_MS = 10000; // 10 segundos
  const MAX_POLL_ERRORS = 3;
  const MIN_POLL_DELAY = 3000; // Mínimo 3s entre polls

  async function pollApiJobs() {
    const now = Date.now();
    
    // ✅ PROTEÇÃO: Evitar polls muito frequentes
    if (now - lastPollTime < MIN_POLL_DELAY) {
      console.log('🛡️ [JobsPanel] Poll muito frequente, aguardando...');
      return;
    }
    
    lastPollTime = now;
    
    try {
      const response = await fetch(`/api/promocoes/jobs?_=${now}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(8000) // Timeout de 8s
      });

      if (response.status === 304) {
        render(); // Re-renderiza o que já temos
        pollErrorCount = 0;
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json().catch(() => ({}));
      const apiJobs = data?.jobs || [];
      
      mergeApiJobs(apiJobs);
      pollErrorCount = 0;
      
      // ✅ PARAR POLLING SE NÃO HÁ JOBS ATIVOS
      const hasActiveJobs = apiJobs.some(job => 
        job.state && !/(conclu|complete|failed|erro)/i.test(job.state)
      );
      
      const hasLocalActiveJobs = Object.values(cache || {}).some(job => 
        !job.dismissed && !job.completed
      );
      
      if (!hasActiveJobs && !hasLocalActiveJobs) {
        console.log('📋 [JobsPanel] Nenhum job ativo, pausando polling...');
        stopPolling();
      }
      
    } catch (error) {
      pollErrorCount++;
      console.warn(`⚠️ [JobsPanel] Erro no polling (${pollErrorCount}/${MAX_POLL_ERRORS}):`, error.message);
      
      // ✅ PARAR POLLING APÓS MUITOS ERROS
      if (pollErrorCount >= MAX_POLL_ERRORS) {
        console.error('❌ [JobsPanel] Muitos erros no polling, parando...');
        stopPolling();
      }
      
      render(); // Renderiza o que já temos
    }
  }

  // ✅ CONTROLE DO POLLING
  function startPolling() {
    if (pollInterval) return; // Já está rodando
    
    console.log('▶️ [JobsPanel] Iniciando polling...');
    pollErrorCount = 0;
    pollApiJobs(); // Poll imediato
    pollInterval = setInterval(pollApiJobs, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollInterval) {
      console.log('⏹️ [JobsPanel] Parando polling...');
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // ✅ INICIAR POLLING APENAS QUANDO NECESSÁRIO
  function ensurePolling() {
    loadIfNeeded();
    const hasActiveJobs = Object.values(cache || {}).some(job => 
      !job.dismissed && !job.completed
    );
    
    if (hasActiveJobs && !pollInterval) {
      startPolling();
    } else if (!hasActiveJobs && pollInterval) {
      setTimeout(stopPolling, 15000); // Para após 15s sem jobs ativos
    }
  }

  function mergeApiJobs(list){
    loadIfNeeded();
    const now = Date.now();
    (Array.isArray(list) ? list : []).forEach(raw => {
      const inc = normalizeIncomingJob(raw);
      if (!inc.id) return;

      const prev = cache[inc.id] || {};
      cache[inc.id] = {
        id: inc.id,
        title: inc.title || prev.title || 'Processo',
        badges: (inc.badges && inc.badges.length) ? inc.badges : (prev.badges || []),
        progress: clampPct(inc.progress != null ? inc.progress : prev.progress || 0),
        state: inc.state != null ? String(inc.state) : (prev.state || ''),
        expected_total: (inc.expected_total != null ? inc.expected_total : prev.expected_total || null),
        done: (inc.done != null ? inc.done : prev.done),
        completed: ('completed' in inc) ? !!inc.completed : guessCompleted(inc.progress ?? prev.progress, inc.state ?? prev.state),
        dismissed: !!prev.dismissed,
        started: prev.started || now,
        updated: now,
        meta: prev.meta || { expected: inc.expected_total || null, pageDone: 0, lastPair: null, maxDen: 0 }
      };

      // Normaliza (acúmulo x/y → expected_total)
      normalizeProgressAndState(cache[inc.id]);
    });
    cleanup(); save(); render();
    
    // ✅ GARANTIR QUE POLLING CONTINUE SE HÁ JOBS ATIVOS
    ensurePolling();
  }

  /* =================================== UI ====================================== */
  function render() {
    const root = ensurePanel(); if (!root) return;
    root.classList.toggle('collapsed', !!ui.collapsed);

    const rows = jobsForRender().map(j => {
      const pct = clampPct(j.progress);
      const state = String(j.state || '');

      // Evita duplicar porcentagem: se state já contém "%", não acrescenta " – 12%"
      const hasPctInState = /(^|[^0-9])\d{1,3}\s*%/.test(state);
      const stateHtml = hasPctInState ? esc(state) : (state ? `${esc(state)} – ${pct}%` : `${pct}%`);

      return (
`<div class="job-row${j.completed ? ' done' : ''}">
  <div class="job-title">${esc(j.title)}${renderBadges(j.badges)}</div>
  <div class="job-state">${stateHtml}</div>
  <div class="job-bar"><div class="job-bar-fill" style="width:${pct}%"></div></div>
  <button class="btn ghost icon job-dismiss" data-id="${esc(j.id)}" title="Fechar">×</button>
</div>`
      );
    }).join('');

    root.innerHTML =
`<div class="job-head">
  <strong>Processos</strong>
  <div class="head-actions">
    <button class="btn ghost icon" id="jpToggle" title="${ui.collapsed ? 'Maximizar' : 'Minimizar'}">${ui.collapsed ? '▢' : '–'}</button>
    <button class="btn ghost icon" id="jpClose" title="Esconder">×</button>
  </div>
</div>
<div class="job-list"${ui.collapsed ? ' style="display:none"' : ''}>
  ${rows || '<div class="muted">Sem processos.</div>'}
</div>`;

    root.querySelector('#jpToggle')?.addEventListener('click', () => {
      ui.collapsed = !ui.collapsed; saveUI(); render();
    });
    // "Fechar" apenas minimiza (painel sempre presente)
    root.querySelector('#jpClose')?.addEventListener('click', () => {
      ui.collapsed = true; saveUI(); render();
    });

    root.querySelectorAll('.job-dismiss').forEach(b => {
      b.addEventListener('click', (e)=> dismiss(e.currentTarget.dataset.id));
    });
  }

  function show(){ 
    const r = ensurePanel(); 
    if (r) r.classList.remove('hidden'); 
    ensurePolling(); // Iniciar polling quando mostrar painel
  }
  
  function hide(){ 
    const r = ensurePanel(); 
    if (r) r.classList.add('hidden'); 
    stopPolling(); // Parar polling quando esconder painel
  }

  // ✅ INICIALIZAÇÃO CONTROLADA
  document.addEventListener('DOMContentLoaded', () => {
    loadUI();
    loadIfNeeded();
    show();    // sempre visível
    render();
    ensurePolling(); // Só inicia polling se necessário
  });

  // ✅ LIMPEZA AO SAIR DA PÁGINA
  window.addEventListener('beforeunload', () => {
    stopPolling();
  });

  // ✅ VISIBILIDADE DA PÁGINA (pausa polling quando não visível)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      ensurePolling();
    }
  });

  /* =============================== Exports ===================================== */
  window.JobsPanel = {
    addLocalJob,
    updateLocalJob,
    replaceId,
    dismiss,
    listActiveIds,
    mergeApiJobs, // << novo: mescla jobs vindos do backend (ex.: /api/promocoes/jobs)
    show, 
    hide,
    // ✅ NOVOS MÉTODOS PARA CONTROLE EXTERNO
    startPolling,
    stopPolling,
    ensurePolling
  };

  // Shim para código que usa "PromoJobs" (ex.: criar-promocao.js)
  if (!window.PromoJobs) {
    window.PromoJobs = {
      noteLocalJobStart(title, ctx = {}) {
        const jobId = addLocalJob({
          title,
          accountKey: ctx.accountKey,
          accountLabel: ctx.accountLabel,
          badges: ctx.badges,
          badge: ctx.badge,
          expected_total: ctx.expected_total
        });
        ensurePolling(); // Garantir que polling está ativo
        return jobId;
      },
      linkLocalToServer(localId, serverId) {
        return replaceId(localId, serverId);
      },
      tick(id, progress, state) {
        updateLocalJob(id, { progress, state });
      },
      dismiss
    };
  }
})();