(function () {
  /* =========================================================================
   * Bulk de promoções – seleção, ações em massa e painel de processos
   * ========================================================================= */

  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s)=> (s==null?'':String(s));

  // ----- Conta atual (cache) -----
  const AccountCtx = (function(){
    let cached = null, pending = null, override = null;

    function set(acc){
      if (!acc) { override = null; return; }
      override = { key: (acc.key||null), label: acc.label || acc.key || '' };
    }

    async function get(){
      if (override) return override;
      if (cached) return cached;
      if (pending) return pending;
      pending = (async () => {
        try {
          const r = await fetch('/api/account/current', { cache:'no-store', credentials:'same-origin' });
          const j = await r.json().catch(()=> ({}));
          const key   = j.accountKey || j.key || j.account || null;
          const label = j.label || j.nickname || key || '';
          cached = { key, label };
        } catch {
          cached = { key:null, label:'' };
        } finally { pending = null; }
        return cached;
      })();
      return pending;
    }
    return { get, set };
  })();

  const ui = {
    wrap:   null,
    btnSel: null,
    btnApp: null,
    btnRem: null,
    chkAllPages: null,
    selBar: null,
    selMsg: null,
    selAllCampaignBtn: null,
    selApplyBtn: null,
    selRemoveBtn: null,
    jobsPanel: document.getElementById('bulkJobsPanel') // painel da lateral (se existir)
  };

  const ctx = {
    promotion_id: null,
    promotion_type: null,
    headerChecked: false,
    filtros: { status:'all', maxDesc:null, mlb:null },
    global: { token:null, total:0, ids:null, selectedAll:false, prepared:false },
    _autoTimer: null,
    _lastKey: ''
  };

  /* ============================ Jobs: histórico ============================= */

  const JOBS_KEY = '__promo_jobs_v1__';
  const JOB_TTL = 24 * 60 * 60 * 1000;
  let jobsCache = loadJobs();

  function loadJobs(){
    try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveJobs(){ localStorage.setItem(JOBS_KEY, JSON.stringify(jobsCache)); }
  function gcJobs(){
    const now = Date.now();
    for (const id in jobsCache) {
      const j = jobsCache[id];
      if (j.dismissed || (now - (j.updated || 0)) > JOB_TTL) delete jobsCache[id];
    }
  }
  function normalizeJob(j){
    const id = String(j.id || j.key || `${j.title || 'Processo'}|${j.created_at || ''}`);
    const progress = Number(j.progress || 0);
    const state = j.state || '';
    const title = j.title || 'Processo';
    const isDoneState = /conclu|complete|failed/i.test(state);
    const completed = progress >= 100 || isDoneState;
    const now = Date.now();
    const prev = jobsCache[id] || {};
    jobsCache[id] = {
      id, title, progress, state, completed,
      // mantém badge de conta se já houver (do placeholder)
      account: prev.account || j.account || null,
      started: prev.started || now,
      updated: now,
      dismissed: !!prev.dismissed
    };
  }
  function recordJobFromApi(list){
    (list || []).forEach(normalizeJob);
    gcJobs(); saveJobs();
  }

  // placeholder com conta (local, id aleatório)
  async function recordPlaceholder(title){
    const id = `ph|${Date.now()}|${Math.random().toString(36).slice(2)}`;
    const acc = await AccountCtx.get();
    jobsCache[id] = {
      id, title, progress: 0, state: 'iniciando…',
      account: { key: acc.key, label: acc.label },
      completed: false, started: Date.now(), updated: Date.now(),
      dismissed: false
    };
    saveJobs();
    return id;
  }

  // placeholder vinculado ao job_id do servidor
  async function recordServerPlaceholder(jobId, title){
    const acc = await AccountCtx.get();
    normalizeJob({
      id: String(jobId),
      title,
      progress: 0,
      state: 'iniciando…',
      account: { key: acc.key, label: acc.label }
    });
    saveJobs(); showJobsPanel(); renderJobsPanel();
    setTimeout(pollJobs, 800);
  }

  function updateLocalJobProgress(id, progress, state){
    const j = jobsCache[id];
    if (!j) return;
    const pct = Math.max(0, Math.min(100, Number(progress || 0)));
    j.progress  = pct;
    if (state) j.state = state;
    j.completed = pct >= 100 || /conclu|complete|failed/i.test(j.state || '');
    j.updated   = Date.now();
    saveJobs();
    renderJobsPanel();
  }
  function dismissJob(id){
    if (jobsCache[id]) { jobsCache[id].dismissed = true; saveJobs(); renderJobsPanel(); }
  }
  function jobsForRender(){
    return Object.values(jobsCache)
      .filter(j => !j.dismissed)
      .sort((a,b) => b.updated - a.updated);
  }

  /* =========================== Painel de processos ========================== */

  function showJobsPanel(){
    if (ui.jobsPanel) ui.jobsPanel.classList.remove('hidden');
  }
  function hideJobsPanel(){
    if (ui.jobsPanel) ui.jobsPanel.classList.add('hidden');
  }

  // badge HTML para a conta
  function renderAccountBadge(acc){
    if (!acc || (!acc.key && !acc.label)) return '';
    const cls = acc.key === 'drossi' ? 'badge-drossi'
             : acc.key === 'diplany' ? 'badge-diplany'
             : acc.key === 'rossidecor' ? 'badge-rossidecor'
             : 'badge-generic';
    const txt = acc.label || acc.key || '';
    return ` <span class="job-badge ${cls}">${esc(txt)}</span>`;
  }

  function renderJobsPanel(){
    if (!ui.jobsPanel) return;

    const list = jobsForRender();
    const rows = list.map(j => {
      const pct   = Math.max(0, Math.min(100, Number(j.progress || 0)));
      const state = j.state || '';
      const title = j.title || 'Processo';
      const done  = !!j.completed;
      const hasPctInState = /(^|[^0-9])\d{1,3}\s*%/.test(state);
      const stateHtml = hasPctInState ? esc(state) : (state ? `${esc(state)} – ${pct}%` : `${pct}%`);

      return `<div class="job-row ${done ? 'done' : ''}">
        <button class="btn ghost icon job-dismiss" data-id="${esc(j.id)}" title="Remover">×</button>
        <div class="job-title">${esc(title)}${renderAccountBadge(j.account)}</div>
        <div class="job-state">${stateHtml}</div>
        <div class="job-bar"><div class="job-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');

    const isCollapsed = ui.jobsPanel.classList.contains('collapsed');
    ui.jobsPanel.innerHTML = `
      <div class="job-head">
        <strong>Processos</strong>
        <div class="head-actions">
          <button class="btn ghost icon" id="bulkJobsToggle" title="${isCollapsed ? 'Maximizar' : 'Minimizar'}">
            ${isCollapsed ? '▢' : '–'}
          </button>
          <button class="btn ghost icon" id="bulkJobsClose" title="Fechar">×</button>
        </div>
      </div>
      <div class="job-list"${isCollapsed ? ' style="display:none"' : ''}>
        ${rows || '<div class="muted">Sem processos.</div>'}
      </div>`;

    ui.jobsPanel.querySelector('#bulkJobsClose')?.addEventListener('click', hideJobsPanel);
    ui.jobsPanel.querySelector('#bulkJobsToggle')?.addEventListener('click', () => {
      ui.jobsPanel.classList.toggle('collapsed');
      renderJobsPanel();
    });
    ui.jobsPanel.querySelectorAll('.job-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => dismissJob(e.currentTarget.dataset.id));
    });
  }

  /* ========================== Helpers de UI da página ======================= */

  function getCampanhaNome(){
    return (document.getElementById('campName')?.textContent || 'Campanha').trim();
  }

  function ensureUI(){
    if (!ui.wrap) {
      ui.wrap     = document.getElementById('bulkControls');
      ui.btnSel   = document.getElementById('bulkSelectAllBtn');
      ui.btnApp   = document.getElementById('bulkApplyAllBtn');
      ui.btnRem   = document.getElementById('bulkRemoveAllBtn');
      ui.chkAllPages = document.getElementById('bulkAllPages');

      if (ui.wrap) {
        if (ui.btnSel) ui.btnSel.addEventListener('click', onSelectAllClick);
        if (ui.btnApp) ui.btnApp.style.display = 'none';
        if (ui.btnRem) ui.btnRem.style.display = 'none';
      }
    }

    if (!ui.selBar) {
      ui.selBar            = document.getElementById('selectionBar');
      ui.selMsg            = document.getElementById('selMsg');
      ui.selAllCampaignBtn = document.getElementById('selAllCampaignBtn');
      ui.selApplyBtn       = document.getElementById('selApplyBtn');
      ui.selRemoveBtn      = document.getElementById('selRemoveBtn');

      if (ui.selAllCampaignBtn) ui.selAllCampaignBtn.addEventListener('click', onSelectWholeCampaign);
      if (ui.selApplyBtn)       ui.selApplyBtn.addEventListener('click', onApplyClick);
      if (ui.selRemoveBtn)      ui.selRemoveBtn.addEventListener('click', onRemoveClick);
    }
  }

  function countVisible(){
    return $$('#tbody input[type="checkbox"][data-mlb]').length;
  }
  function countSelected(){
    return $$('#tbody input[type="checkbox"][data-mlb]:checked').length;
  }
  function getSelectedMLBs(){
    return $$('#tbody input[type="checkbox"][data-mlb]:checked').map(x => x.dataset.mlb);
  }

  function renderTopControls(){
    ensureUI();
    if (!ui.wrap || !ui.btnSel) return;

    const totalVisiveis = countVisible();
    if (!ctx.headerChecked || totalVisiveis === 0) {
      ui.wrap.classList.add('hidden');
    } else {
      ui.wrap.classList.remove('hidden');
      ui.btnSel.textContent = `Selecionar todos (${totalVisiveis} exibidos)`;
    }
  }
  function updateSelectionBar(){
    ensureUI();
    if (!ui.selBar || !ui.selMsg) return;

    const pageSel = countSelected();
    const isGlobal = !!ctx.global.selectedAll;
    const globTotal = Number(ctx.global.total || 0);

    let msg = '';
    if (pageSel > 0) {
      msg = `${pageSel} ${pageSel === 1 ? 'anúncio' : 'anúncios'} selecionado${pageSel>1?'s':''} nesta página`;
    }
    if (isGlobal) {
      const tail = `(filtrados)`;
      msg = msg
        ? `${msg} • toda a campanha: ${globTotal} selecionado${globTotal===1?'':'s'} ${tail}`
        : `Toda a campanha: ${globTotal} selecionado${globTotal===1?'':'s'} ${tail}`;
    }
    ui.selMsg.textContent = msg || 'Nenhum item selecionado.';

    if (pageSel > 0 || isGlobal) ui.selBar.classList.remove('hidden');
    else ui.selBar.classList.add('hidden');

    if (ui.selAllCampaignBtn) {
      if (isGlobal) {
        ui.selAllCampaignBtn.textContent = `Selecionando toda a campanha (${globTotal} filtrados)`;
        ui.selAllCampaignBtn.classList.add('warn');
      } else {
        ui.selAllCampaignBtn.textContent = 'Selecionar toda a campanha';
        ui.selAllCampaignBtn.classList.remove('warn');
      }
    }

    const nothing = (pageSel === 0 && !isGlobal);
    if (ui.selApplyBtn)  ui.selApplyBtn.disabled  = nothing;
    if (ui.selRemoveBtn) ui.selRemoveBtn.disabled = nothing;
  }

  function render(){
    renderTopControls();
    updateSelectionBar();
  }

  function onSelectAllClick(){
    $$('#tbody input[type="checkbox"][data-mlb]').forEach(ch => ch.checked = true);
    render();
  }

  /* ========================== Seleção de campanha =========================== */

  function mapStatusForPrepare(v){
    if (v === 'started' || v === 'candidate') return v;
    if (v === 'yes')  return 'started';
    if (v === 'non')  return 'candidate';
    return null; // 'all'
  }

  function buildBulkFilters(){
    const status = mapStatusForPrepare(ctx.filtros.status);
    const maxDesc = (ctx.filtros.maxDesc == null || ctx.filtros.maxDesc === '') ? null : Number(ctx.filtros.maxDesc);
    const mlb = (ctx.filtros.mlb || null);

    const f = {};
    if (status) f.status = status; // 'started' | 'candidate'
    if (maxDesc != null) f.discount_max = maxDesc; // o backend aceita discount_max ou maxDesc
    if (mlb) f.query_mlb = mlb; // o backend aceita query_mlb ou mlb
    return f;
  }

  function getDryRun(){
    const el = document.getElementById('dryRunToggle');
    return !!(el && el.checked);
  }

  async function prepareWholeCampaign(){
    if (!ctx.promotion_id || !ctx.promotion_type) {
      alert('Selecione uma campanha.');
      return null;
    }
    try {
      const body = {
        promotion_id: ctx.promotion_id,
        promotion_type: ctx.promotion_type,
        status: mapStatusForPrepare(ctx.filtros.status),
        mlb: (ctx.filtros.mlb || null),
        percent_max: (ctx.filtros.maxDesc == null || ctx.filtros.maxDesc === '') ? null : Number(ctx.filtros.maxDesc)
      };
      const r = await fetch('/api/promocoes/selection/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), credentials: 'same-origin'
      });
      if (r.status === 404) throw new Error('endpoint-not-found');
      const js = await r.json().catch(()=> ({}));
      if (!r.ok || js?.ok === false) throw new Error('prepare-failed');
      return { token: js.token, total: Number(js.total || 0), ids: null };
    } catch {
      try {
        const getAll = window.coletarTodosIdsFiltrados;
        if (typeof getAll !== 'function') throw new Error('fallback-missing');
        const ids = await getAll();
        return { token: null, total: ids.length, ids };
      } catch {
        alert('Não foi possível preparar a seleção da campanha.');
        return null;
      }
    }
  }

  async function onSelectWholeCampaign(){
    if (ctx.global.selectedAll) {
      ctx.global = { token:null, total:0, ids:null, selectedAll:false, prepared:false };
      render(); return;
    }
    const prep = await prepareWholeCampaign();
    if (!prep) return;
    ctx.global.token = prep.token;
    ctx.global.total = prep.total;
    ctx.global.ids   = prep.ids;
    ctx.global.selectedAll = true;
    ctx.global.prepared    = true;
    render();
  }

  async function autoPrepare(){
    if (!ctx.promotion_id) return;
    const prep = await prepareWholeCampaign();
    if (!prep) return;
    ctx.global.token = prep.token;
    ctx.global.total = prep.total;
    ctx.global.ids   = prep.ids;
    ctx.global.prepared = true;
    updateSelectionBar();
  }
  function scheduleAutoPrepare(){
    const key = [
      ctx.promotion_id, ctx.promotion_type,
      ctx.filtros.status, ctx.filtros.maxDesc, ctx.filtros.mlb
    ].join('|');
    if (ctx._lastKey === key) return;
    ctx._lastKey = key;
    clearTimeout(ctx._autoTimer);
    ctx._autoTimer = setTimeout(() => autoPrepare().catch(()=>{}), 800);
  }

  /* =========================== Fila local (1 a 1) =========================== */

  const DEFAULT_DELAY_MS = 900;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  async function noteLocalJobStart(title){
    const id = await recordPlaceholder(title);
    showJobsPanel();
    renderJobsPanel();
    setTimeout(pollJobs, 1000);
    return id;
  }

  async function applyQueue(ids, delayMs = DEFAULT_DELAY_MS){
    if (!Array.isArray(ids) || !ids.length) return;

    const delayInput = document.getElementById('bulkDelayMs');
    if (delayInput) {
      const v = Number(String(delayInput.value || '').replace(',','.'));
      if (!Number.isNaN(v) && v >= 0) delayMs = v;
    }

    const camp = getCampanhaNome();
    const jobId  = await noteLocalJobStart(`Aplicação (fila) – ${camp} (${ids.length} itens)`);

    let done = 0, ok = 0, err = 0;
    showJobsPanel();

    if (typeof window.aplicarUnico !== 'function') {
      alert('Função aplicarUnico não encontrada.');
      updateLocalJobProgress(jobId, 0, 'erro ao iniciar');
      return;
    }

    for (const id of ids) {
      try {
        const res = await window.aplicarUnico(id, { silent: true });
        if (res) ok++; else err++;
      } catch {
        err++;
      }
      done++;
      const pct = Math.round((done / ids.length) * 100);
      updateLocalJobProgress(jobId, pct, `processando ${done}/${ids.length}…`);
      if (delayMs > 0 && done < ids.length) await sleep(delayMs);
    }

    updateLocalJobProgress(jobId, 100, `concluído: ${ok} ok, ${err} erros`);
  }

  /* ====================== Ações (aplicar / remover todos) =================== */

  async function onApplyClick(){
    // Bloqueio explícito para PRICE_MATCHING_MELI_ALL (manual indisponível)
    if (String(ctx.promotion_type || '').toUpperCase() === 'PRICE_MATCHING_MELI_ALL') {
      alert('Esta campanha (PRICE_MATCHING_MELI_ALL) é 100% gerida pelo ML. Aplicação manual indisponível.');
      return;
    }

    // Prioriza APPLY-BULK (backend varre todas as páginas com os filtros)
    if (ctx.global.selectedAll && ctx.promotion_id && ctx.promotion_type) {
      try {
        const body = {
          promotion_type: ctx.promotion_type,
          filters: buildBulkFilters(),
          options: { dryRun: getDryRun() }
        };
        const url = `/api/promocoes/promotions/${encodeURIComponent(ctx.promotion_id)}/apply-bulk`;
        let r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        });

        // Se o endpoint novo não existir / falhar, cai para os caminhos antigos
        if (r.status === 404 || r.status === 405) throw new Error('apply-bulk-not-found');

        const js = await r.json().catch(()=> ({}));
        if (r.ok && (js?.success || js?.ok)) {
          const camp = getCampanhaNome();
          const qtd  = Number(ctx.global.total || 0);
          // cria placeholder com o job_id real do servidor (melhor UX)
          if (js.job_id) {
            await recordServerPlaceholder(js.job_id, `Aplicação – ${camp} (${qtd} itens)`);
          } else {
            await noteLocalJobStart(`Aplicação – ${camp} (${qtd} itens)`);
          }
          showJobsPanel();
          pollJobs();
          return;
        }

        // 400 típico etc -> cai para fallback
        throw new Error(js?.error || 'apply-bulk-failed');
      } catch {
        // Fallback #1: seleção por token (rota fase 2)
        try {
          if (ctx.global.token) {
            const r2 = await fetch('/api/promocoes/jobs/apply-mass', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: ctx.global.token, action: 'apply', values: {} }),
              credentials: 'same-origin'
            });
            const js2 = await r2.json().catch(()=> ({}));
            if (r2.ok && js2?.ok !== false) {
              const camp = getCampanhaNome();
              const qtd  = Number(ctx.global.total || 0);
              await noteLocalJobStart(`Aplicação – ${camp} (${qtd} itens)`);
              showJobsPanel();
              pollJobs();
              return;
            }
          }
        } catch {}

        // Fallback #2: aplicar localmente 1 a 1
        let ids = Array.isArray(ctx.global.ids) ? ctx.global.ids : null;
        if (!ids || !ids.length) {
          const getAll = window.coletarTodosIdsFiltrados;
          if (typeof getAll === 'function') ids = await getAll();
        }
        if (!ids || !ids.length) {
          alert('Não foi possível iniciar a aplicação em massa.');
          return;
        }
        await applyQueue(ids, DEFAULT_DELAY_MS);
        return;
      }
    }

    // Caso não esteja em "toda campanha": usa os selecionados da página
    if (ctx.global.selectedAll && Array.isArray(ctx.global.ids) && ctx.global.ids.length) {
      await applyQueue(ctx.global.ids, DEFAULT_DELAY_MS);
      return;
    }

    const mlbs = getSelectedMLBs();
    if (!mlbs.length) return;

    await applyQueue(mlbs, DEFAULT_DELAY_MS);
    render();
  }

  async function onRemoveClick(){
    if (ctx.global.selectedAll && ctx.global.token) {
      try {
        let r = await fetch('/api/promocoes/jobs/apply-mass', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ctx.global.token, action: 'remove' }),
          credentials: 'same-origin'
        });

        if (r.status === 404 || !r.ok) {
          const body = {
            action: 'remove',
            promotion_id: ctx.promotion_id,
            promotion_type: ctx.promotion_type,
            filters: {
              status: ctx.filtros.status,
              maxDesc: ctx.filtros.maxDesc,
              mlb: ctx.filtros.mlb || null
            }
          };
          r = await fetch('/api/promocoes/bulk/prepare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), credentials: 'same-origin'
          });
        }

        const js = await r.json().catch(()=> ({}));
        if (!r.ok || js?.ok === false) {
          alert('Falha ao iniciar remoção em massa.');
          return;
        }

        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.total || 0);
        await noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

        showJobsPanel();
        pollJobs();
        return;
      } catch {
        alert('Erro ao iniciar remoção em massa.');
        return;
      }
    }

    if (ctx.global.selectedAll && Array.isArray(ctx.global.ids) && ctx.global.ids.length) {
      try {
        const r = await fetch('/api/promocoes/jobs/remove', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: ctx.global.ids, delay_ms: 250 }),
          credentials: 'same-origin'
        });
        const js = await r.json().catch(()=> ({}));
        if (!r.ok || js?.ok === false) {
          alert('Falha ao iniciar remoção em massa (filtrados).');
          return;
        }

        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.ids.length || 0);
        await noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

        showJobsPanel();
        pollJobs();
      } catch {
        alert('Erro ao iniciar remoção (filtrados).');
      }
      return;
    }

    const mlbs = getSelectedMLBs();
    if (!mlbs.length) return;

    try {
      const r = await fetch('/api/promocoes/jobs/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: mlbs, delay_ms: 250 }),
        credentials: 'same-origin'
      });
      const js = await r.json().catch(()=> ({}));
      if (!r.ok || js?.ok === false) {
        alert('Falha ao iniciar remoção em massa (selecionados).');
        return;
      }

      const camp = getCampanhaNome();
      const qtd  = Number(mlbs.length || 0);
      await noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

      showJobsPanel();
      pollJobs();
    } catch {
      alert('Erro ao iniciar remoção (selecionados).');
    }
  }

  /* ============================== Jobs: polling ============================= */

  // ✅ SISTEMA DE POLLING INTELIGENTE COM CONTROLE DE LOOP
  let pollInterval = null;
  let pollErrorCount = 0;
  let lastPollTime = 0;
  const POLL_INTERVAL_MS = 8000; // Aumentado de 5s para 8s
  const MAX_POLL_ERRORS = 3;
  const MIN_POLL_DELAY = 2000; // Mínimo 2s entre polls

  async function pollJobs(){
    const now = Date.now();
    
    // ✅ PROTEÇÃO: Evitar polls muito frequentes
    if (now - lastPollTime < MIN_POLL_DELAY) {
      console.log('🛡️ Poll muito frequente, aguardando...');
      return;
    }
    
    lastPollTime = now;
    
    try {
      const r = await fetch(`/api/promocoes/jobs?_=${now}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(5000) // Timeout de 5s
      });

      // Se o servidor ainda devolver 304, apenas re-renderiza o que já temos
      if (r.status === 304) { 
        renderJobsPanel(); 
        pollErrorCount = 0; // Reset contador de erro
        return; 
      }
      
      if (!r.ok) { 
        throw new Error(`HTTP ${r.status}`);
      }

      const data = await r.json().catch(()=>({}));
      const apiJobs = (data?.jobs || []);
      
      recordJobFromApi(apiJobs);
      renderJobsPanel();
      pollErrorCount = 0; // Reset contador de erro
      
      // ✅ PARAR POLLING SE NÃO HÁ JOBS ATIVOS
      const hasActiveJobs = apiJobs.some(job => 
        job.state && !/(conclu|complete|failed|erro)/i.test(job.state)
      );
      
      if (!hasActiveJobs && Object.keys(jobsCache).length === 0) {
        console.log('📋 Nenhum job ativo, pausando polling...');
        stopPolling();
      }
      
    } catch (error) {
      pollErrorCount++;
      console.warn(`⚠️ Erro no polling (${pollErrorCount}/${MAX_POLL_ERRORS}):`, error.message);
      
      // ✅ PARAR POLLING APÓS MUITOS ERROS
      if (pollErrorCount >= MAX_POLL_ERRORS) {
        console.error('❌ Muitos erros no polling, parando...');
        stopPolling();
      }
      
      renderJobsPanel(); // Renderiza o que já temos
    }
  }

  // ✅ CONTROLE DO POLLING
  function startPolling() {
    if (pollInterval) return; // Já está rodando
    
    console.log('▶️ Iniciando polling de jobs...');
    pollErrorCount = 0;
    pollJobs(); // Poll imediato
    pollInterval = setInterval(pollJobs, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollInterval) {
      console.log('⏹️ Parando polling de jobs...');
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // ✅ INICIAR POLLING APENAS QUANDO NECESSÁRIO
  function ensurePolling() {
    const hasJobs = Object.keys(jobsCache).length > 0;
    const hasActiveJobs = Object.values(jobsCache).some(job => !job.completed && !job.dismissed);
    
    if (hasActiveJobs && !pollInterval) {
      startPolling();
    } else if (!hasActiveJobs && pollInterval) {
      setTimeout(stopPolling, 10000); // Para após 10s sem jobs ativos
    }
  }

  /* ============================= API pública (UI) =========================== */

  window.PromoBulk = {
    setContext({ promotion_id, promotion_type, filtroParticipacao, maxDesc, mlbFilter }){
      ctx.promotion_id   = promotion_id;
      ctx.promotion_type = promotion_type;

      ctx.filtros.status = (filtroParticipacao === 'yes') ? 'started'
                          : (filtroParticipacao === 'non') ? 'candidate' : 'all';
      ctx.filtros.maxDesc = (maxDesc == null || maxDesc === '') ? null : Number(maxDesc);
      ctx.filtros.mlb = (mlbFilter || '').trim() || null;

      if (ctx.global.selectedAll) {
        ctx.global = { token:null, total:0, ids:null, selectedAll:false, prepared:false };
      }
      scheduleAutoPrepare();
      render();
    },
    onHeaderToggle(checked){
      ctx.headerChecked = !!checked; render();
    },
    // permite ao wrapper do HTML injetar a conta atual para os jobs
    setAccountContext(acc){
      AccountCtx.set(acc);
    },
    // ✅ MÉTODOS PARA CONTROLAR POLLING EXTERNAMENTE
    startPolling,
    stopPolling,
    pollJobs: () => {
      ensurePolling();
      if (!pollInterval) pollJobs(); // Poll único se não estiver rodando
    }
  };

  // ✅ EVENTOS OTIMIZADOS
  document.addEventListener('change', (ev) => {
    if (ev.target?.matches?.('#tbody input[type="checkbox"][data-mlb]')) render();
  });
  
  const tbody = document.getElementById('tbody');
  if (tbody) {
    const obs = new MutationObserver(render);
    obs.observe(tbody, { childList: true, subtree: false });
  }

  // ✅ INICIALIZAÇÃO CONTROLADA
  document.addEventListener('DOMContentLoaded', () => {
    ensureUI(); 
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

})();