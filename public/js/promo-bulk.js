(function () {
  /* =========================================================================
   * Bulk de promoções – seleção, ações em massa e painel de processos
   * ========================================================================= */

  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s)=> (s==null?'':String(s));

  // ----- Conta atual (cache) -----
  const AccountCtx = (function(){
    let cached = null, pending = null;
    async function get(){
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
    return { get };
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
    const completed = progress >= 100 || /conclu/i.test(state);
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

  // placeholder com conta
  async function recordPlaceholder(title){
    const id = `ph|${Date.now()}|${Math.random().toString(36).slice(2)}`;
    const acc = await AccountCtx.get();
    jobsCache[id] = {
      id, title, progress: 0, state: 'iniciando…',
      account: { key: acc.key, label: acc.label }, // << guarda conta
      completed: false, started: Date.now(), updated: Date.now(),
      dismissed: false
    };
    saveJobs();
    return id;
  }

  function updateLocalJobProgress(id, progress, state){
    const j = jobsCache[id];
    if (!j) return;
    const pct = Math.max(0, Math.min(100, Number(progress || 0)));
    j.progress  = pct;
    if (state) j.state = state;
    j.completed = pct >= 100 || /conclu/i.test(j.state || '');
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
    const id = await recordPlaceholder(title);   // (guarda conta no placeholder)
    showJobsPanel();
    renderJobsPanel();
    setTimeout(pollJobs, 1000);
    return id;

    // Se quiser migrar esta tela para o JobsPanel global, bastaria:
    // const acc = await AccountCtx.get();
    // JobsPanel.addLocalJob({ title, accountKey: acc.key, accountLabel: acc.label });
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
    if (ctx.global.selectedAll && ctx.global.token) {
      try {
        let r = await fetch('/api/promocoes/jobs/apply-mass', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ctx.global.token, action: 'apply', values: {} }),
          credentials: 'same-origin'
        });

        if (r.status === 404 || r.status >= 500 || !r.ok) {
          let ids = Array.isArray(ctx.global.ids) ? ctx.global.ids : null;
          if (!ids || !ids.length) {
            const getAll = window.coletarTodosIdsFiltrados;
            if (typeof getAll === 'function') ids = await getAll();
          }
          if (!ids || !ids.length) {
            alert('Não foi possível obter a lista de itens para aplicar.');
            return;
          }
          await applyQueue(ids, DEFAULT_DELAY_MS);
          return;
        }

        const js = await r.json().catch(()=> ({}));
        if (!r.ok || js?.ok === false) {
          let ids = Array.isArray(ctx.global.ids) ? ctx.global.ids : null;
          if (!ids || !ids.length) {
            const getAll = window.coletarTodosIdsFiltrados;
            if (typeof getAll === 'function') ids = await getAll();
          }
          if (!ids || !ids.length) {
            alert('Falha ao iniciar aplicação em massa.');
            return;
          }
          await applyQueue(ids, DEFAULT_DELAY_MS);
          return;
        }

        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.total || 0);
        await noteLocalJobStart(`Aplicação – ${camp} (${qtd} itens)`);
        showJobsPanel();
        pollJobs();
        return;
      } catch {
        let ids = Array.isArray(ctx.global.ids) ? ctx.global.ids : null;
        if (!ids || !ids.length) {
          const getAll = window.coletarTodosIdsFiltrados;
          if (typeof getAll === 'function') ids = await getAll();
        }
        if (!ids || !ids.length) { alert('Erro ao iniciar aplicação em massa.'); return; }
        await applyQueue(ids, DEFAULT_DELAY_MS);
        return;
      }
    }

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

  async function pollJobs(){
    try {
      const r = await fetch('/api/promocoes/jobs', { credentials: 'same-origin' });
      if (!r.ok) { renderJobsPanel(); return; }
      const data = await r.json().catch(()=>({}));
      const apiJobs = (data?.jobs || []);
      recordJobFromApi(apiJobs);
      renderJobsPanel();
    } catch { renderJobsPanel(); }
  }
  setInterval(pollJobs, 5000);

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
    }
  };

  document.addEventListener('change', (ev) => {
    if (ev.target?.matches?.('#tbody input[type="checkbox"][data-mlb]')) render();
  });
  const tbody = document.getElementById('tbody');
  if (tbody) {
    const obs = new MutationObserver(render);
    obs.observe(tbody, { childList: true, subtree: false });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureUI(); render(); pollJobs();
  });

})();
