// public/js/promo-bulk.js
(function () {
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s)=> (s==null?'':String(s));

  const ui = {
    wrap:   null,
    btnSel: null,
    btnApp: null,
    btnRem: null,
    chkAllPages: null,

    // Barra de seleção (linha de baixo)
    selBar: null,
    selMsg: null,
    selAllCampaignBtn: null,
    selApplyBtn: null,
    selRemoveBtn: null,

    jobsPanel: null
  };

  const ctx = {
    promotion_id: null,
    promotion_type: null,
    headerChecked: false,

    // filtros espelhados do criar-promocao.js
    filtros: {
      status: 'all',      // 'all' | 'started' | 'candidate'
      maxDesc: null,      // número ou null (Desc. máx.)
      mlb: null
    },

    // seleção global (toda a campanha)
    global: {
      token: null,          // token devolvido pelo back
      total: 0,             // total de itens filtrados
      ids: null,            // fallback (lista de MLBs) quando não houver endpoint
      selectedAll: false,
      prepared: false
    },

    // debouncer p/ precompute quando filtro muda
    _autoTimer: null,
    _lastKey: ''
  };

  /* ------------------------------ UI / Jobs Panel helpers ------------------------------ */

  // Placeholders e jobs locais (sem backend)
  const jobsLocal = [];

  function showJobsPanel(){
    if (!ui.jobsPanel) return;
    ui.jobsPanel.classList.remove('hidden');
  }
  function hideJobsPanel(){
    if (!ui.jobsPanel) return;
    ui.jobsPanel.classList.add('hidden');
  }

  // cria um job local e retorna a referência para atualizar progresso
  function noteLocalJobStart(title){
    const job = { title, progress: 0, state: 'iniciando…', _ts: Date.now(), _local: true };
    jobsLocal.push(job);
    showJobsPanel();
    renderJobsPanel([]);          // mostra placeholder imediatamente
    setTimeout(pollJobs, 1000);   // força 1º refresh logo em seguida
    return job;
  }
  function updateLocalJob(job, progress, state){
    if (!job) return;
    job.progress = Math.max(0, Math.min(100, Number(progress||0)));
    if (state) job.state = state;
    renderJobsPanel([]); // re-render rápido usando apenas locais
  }

  function renderJobsPanel(apiJobs){
    // descarta placeholders muito antigos (exceto os que estamos atualizando)
    const now = Date.now();
    const placeholders = jobsLocal.filter(j => j._local || (now - j._ts < 20000));

    const jobs = [...placeholders, ...(apiJobs || [])];
    const rows = jobs.map(j => {
      const pct = j.progress || 0;
      const state = j.state || '';
      const title = j.title || 'Job';
      return `<div class="job-row">
        <div class="job-title">${esc(title)}</div>
        <div class="job-state">${esc(state)} – ${pct}%</div>
        <div class="job-bar"><div class="job-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');

    if (ui.jobsPanel) {
      ui.jobsPanel.innerHTML = `
        <div class="job-head">
          <strong>Processos</strong>
          <button class="btn ghost" id="bulkJobsClose">×</button>
        </div>
        <div class="job-list">${rows || '<div class="muted">Sem processos.</div>'}</div>`;
      ui.jobsPanel.querySelector('#bulkJobsClose')?.addEventListener('click', hideJobsPanel);
    }
  }

  function getCampanhaNome(){
    return (document.getElementById('campName')?.textContent || 'Campanha').trim();
  }

  /* ------------------------------ UI básica ------------------------------ */

  function ensureUI(){
    if (!ui.wrap) {
      ui.wrap     = document.getElementById('bulkControls');
      ui.btnSel   = document.getElementById('bulkSelectAllBtn');
      ui.btnApp   = document.getElementById('bulkApplyAllBtn');
      ui.btnRem   = document.getElementById('bulkRemoveAllBtn');
      ui.chkAllPages = document.getElementById('bulkAllPages');
      ui.jobsPanel   = document.getElementById('bulkJobsPanel');

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

    // mostra wrapper só quando header checkbox estiver marcado
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

    // Mensagem
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

    // Exibição
    if (pageSel > 0 || isGlobal) {
      ui.selBar.classList.remove('hidden');
    } else {
      ui.selBar.classList.add('hidden');
    }

    // Estado do botão “Selecionar toda a campanha”
    if (ui.selAllCampaignBtn) {
      if (isGlobal) {
        ui.selAllCampaignBtn.textContent = `Selecionando toda a campanha (${globTotal} filtrados)`;
        ui.selAllCampaignBtn.classList.add('warn');
      } else {
        ui.selAllCampaignBtn.textContent = 'Selecionar toda a campanha';
        ui.selAllCampaignBtn.classList.remove('warn');
      }
    }

    // Habilitações
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

  /* ------------------------- Seleção de campanha ------------------------- */

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

    // 1) tenta via endpoint rápido do back
    try {
      const body = {
        promotion_id: ctx.promotion_id,
        promotion_type: ctx.promotion_type,
        status: mapStatusForPrepare(ctx.filtros.status),
        mlb: (ctx.filtros.mlb || null),
        percent_max: (ctx.filtros.maxDesc == null || ctx.filtros.maxDesc === '') ? null : Number(ctx.filtros.maxDesc)
      };
      const r = await fetch('/api/promocoes/selection/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin'
      });
      // se o endpoint não existir, cai no fallback:
      if (r.status === 404) throw new Error('endpoint-not-found');
      const js = await r.json().catch(()=> ({}));
      if (!r.ok || js?.ok === false) throw new Error('prepare-failed');
      return { token: js.token, total: Number(js.total || 0), ids: null };
    } catch (e) {
      // 2) fallback: varre no front usando a função exposta pelo criar-promocao.js
      try {
        const getAll = window.coletarTodosIdsFiltrados;
        if (typeof getAll !== 'function') throw new Error('fallback-missing');
        const ids = await getAll();
        return { token: null, total: ids.length, ids };
      } catch (err) {
        console.warn('prepareWholeCampaign fallback error', err);
        alert('Não foi possível preparar a seleção da campanha.');
        return null;
      }
    }
  }

  async function onSelectWholeCampaign(){
    // toggle
    if (ctx.global.selectedAll) {
      ctx.global = { token:null, total:0, ids:null, selectedAll:false, prepared:false };
      render();
      return;
    }
    const prep = await prepareWholeCampaign();
    if (!prep) return;
    ctx.global.token = prep.token;
    ctx.global.total = prep.total;
    ctx.global.ids   = prep.ids; // se veio pelo fallback, guardamos os MLBs
    ctx.global.selectedAll = true;
    ctx.global.prepared    = true;
    render();
  }

  // auto precompute quando filtros mudarem (debounce)
  async function autoPrepare(){
    if (!ctx.promotion_id) return;
    const prep = await prepareWholeCampaign();
    if (!prep) return;
    // não ligamos a seleção automaticamente; apenas atualizamos a contagem para o botão
    ctx.global.token = prep.token;
    ctx.global.total = prep.total;
    ctx.global.ids   = prep.ids;
    ctx.global.prepared = true;
    // não seta selectedAll aqui
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

  /* ---------------------- Fila local (apply 1 a 1) ---------------------- */

  const DEFAULT_DELAY_MS = 900; // pausa entre itens

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  async function applyQueue(ids, delayMs = DEFAULT_DELAY_MS){
    if (!Array.isArray(ids) || !ids.length) return;

    // delay configurável via input opcional
    const delayInput = document.getElementById('bulkDelayMs');
    if (delayInput) {
      const v = Number(String(delayInput.value || '').replace(',','.'));
      if (!Number.isNaN(v) && v >= 0) delayMs = v;
    }

    const camp = getCampanhaNome();
    const job  = noteLocalJobStart(`Aplicação (fila) – ${camp} (${ids.length} itens)`);

    let done = 0, ok = 0, err = 0;
    showJobsPanel();

    if (typeof window.aplicarUnico !== 'function') {
      alert('Função aplicarUnico não encontrada.');
      updateLocalJob(job, 0, 'erro ao iniciar');
      return;
    }

    for (const id of ids) {
      try {
        const res = await window.aplicarUnico(id, { silent: true });
        if (res) ok++; else err++;
      } catch (e) {
        console.warn('[bulk] falha aplicar', id, e);
        err++;
      }
      done++;
      const pct = Math.round((done / ids.length) * 100);
      updateLocalJob(job, pct, `processando ${done}/${ids.length}…`);
      if (delayMs > 0 && done < ids.length) await sleep(delayMs);
    }

    updateLocalJob(job, 100, `concluído: ${ok} ok, ${err} erros`);
  }

  /* ------------------- Ações (aplicar / remover todos) ------------------- */

  async function onApplyClick(){
    // 1) Modo campanha: tentar o endpoint novo com token
    if (ctx.global.selectedAll && ctx.global.token) {
      try {
        let r = await fetch('/api/promocoes/jobs/apply-mass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ctx.global.token, action: 'apply', values: {} }),
          credentials: 'same-origin'
        });

        // Se 5xx (503/500) ou 404 -> fallback para fila local 1 a 1
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
          console.error('apply mass error', r.status, js);
          // fallback final: fila local 1 a 1
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

        // Se o backend iniciou o job, apenas mostramos placeholder e seguimos
        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.total || 0);
        noteLocalJobStart(`Aplicação – ${camp} (${qtd} itens)`);
        showJobsPanel();
        pollJobs();
        return;
      } catch (e) {
        console.warn('onApplyClick err', e);
        // fallback: fila local 1 a 1
        let ids = Array.isArray(ctx.global.ids) ? ctx.global.ids : null;
        if (!ids || !ids.length) {
          const getAll = window.coletarTodosIdsFiltrados;
          if (typeof getAll === 'function') ids = await getAll();
        }
        if (!ids || !ids.length) {
          alert('Erro ao iniciar aplicação em massa.');
          return;
        }
        await applyQueue(ids, DEFAULT_DELAY_MS);
        return;
      }
    }

    // 2) Modo campanha (fallback ids explícitos) -> fila local
    if (ctx.global.selectedAll && Array.isArray(ctx.global.ids) && ctx.global.ids.length) {
      await applyQueue(ctx.global.ids, DEFAULT_DELAY_MS);
      return;
    }

    // 3) Página atual (selecionados) -> fila local
    const mlbs = getSelectedMLBs();
    if (!mlbs.length) return;

    await applyQueue(mlbs, DEFAULT_DELAY_MS);
    render();
  }

  async function onRemoveClick(){
    // 1) Modo campanha: tentar o endpoint novo com token
    if (ctx.global.selectedAll && ctx.global.token) {
      try {
        let r = await fetch('/api/promocoes/jobs/apply-mass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ctx.global.token, action: 'remove' }),
          credentials: 'same-origin'
        });

        // Fallback para o endpoint antigo se não existir ou falhar
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'same-origin'
          });
        }

        const js = await r.json().catch(()=> ({}));
        if (!r.ok || js?.ok === false) {
          console.error('remove mass error', r.status, js);
          alert('Falha ao iniciar remoção em massa.');
          return;
        }

        // Placeholder otimista
        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.total || 0);
        noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

        showJobsPanel();
        pollJobs();
        return;
      } catch (e) {
        console.warn('onRemoveClick err', e);
        alert('Erro ao iniciar remoção em massa.');
        return;
      }
    }

    // 2) Modo campanha (fallback ids) -> endpoint de remoção em lote
    if (ctx.global.selectedAll && Array.isArray(ctx.global.ids) && ctx.global.ids.length) {
      try {
        const r = await fetch('/api/promocoes/jobs/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: ctx.global.ids, delay_ms: 250 }),
          credentials: 'same-origin'
        });
        const js = await r.json().catch(()=> ({}));
        if (!r.ok || js?.ok === false) {
          console.error('jobs/remove (fallback) erro', r.status, js);
          alert('Falha ao iniciar remoção em massa (filtrados).');
          return;
        }

        // Placeholder otimista
        const camp = getCampanhaNome();
        const qtd  = Number(ctx.global.ids.length || 0);
        noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

        showJobsPanel();
        pollJobs();
      } catch (e) {
        console.warn('remove fallback err', e);
        alert('Erro ao iniciar remoção (filtrados).');
      }
      return;
    }

    // 3) Página atual (selecionados)
    const mlbs = getSelectedMLBs();
    if (!mlbs.length) return;

    try {
      const r = await fetch('/api/promocoes/jobs/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: mlbs, delay_ms: 250 }),
        credentials: 'same-origin'
      });
      const js = await r.json().catch(()=> ({}));
      if (!r.ok || js?.ok === false) {
        console.error('jobs/remove erro', r.status, js);
        alert('Falha ao iniciar remoção em massa (selecionados).');
        return;
      }

      // Placeholder otimista
      const camp = getCampanhaNome();
      const qtd  = Number(mlbs.length || 0);
      noteLocalJobStart(`Remoção – ${camp} (${qtd} itens)`);

      showJobsPanel();
      pollJobs();
    } catch (e) {
      console.warn('remove selecionados err', e);
      alert('Erro ao iniciar remoção (selecionados).');
    }
  }

  /* -------------------------------- Jobs Poll -------------------------------- */

  async function pollJobs(){
    try {
      const r = await fetch('/api/promocoes/jobs', { credentials: 'same-origin' });
      if (!r.ok) { 
        renderJobsPanel([]); 
        return; 
      }
      const data = await r.json().catch(()=>({}));
      renderJobsPanel(data?.jobs || []);
    } catch {
      renderJobsPanel([]);
    }
  }
  setInterval(pollJobs, 5000);

  /* --------------------------- API pública (hooks) ------------------------ */

  window.PromoBulk = {
    setContext({ promotion_id, promotion_type, filtroParticipacao, maxDesc, mlbFilter }){
      ctx.promotion_id   = promotion_id;
      ctx.promotion_type = promotion_type;

      ctx.filtros.status = (filtroParticipacao === 'yes') ? 'started'
                          : (filtroParticipacao === 'non') ? 'candidate' : 'all';
      ctx.filtros.maxDesc = (maxDesc == null || maxDesc === '') ? null : Number(maxDesc);
      ctx.filtros.mlb = (mlbFilter || '').trim() || null;

      // filtros mudaram -> invalida seleção ativa e agenda precompute
      if (ctx.global.selectedAll) {
        ctx.global = { token:null, total:0, ids:null, selectedAll:false, prepared:false };
      }
      scheduleAutoPrepare();
      render();
    },
    onHeaderToggle(checked){
      ctx.headerChecked = !!checked;
      render();
    }
  };

  // Re-render quando checkboxes mudam / quando a tabela troca
  document.addEventListener('change', (ev) => {
    if (ev.target?.matches?.('#tbody input[type="checkbox"][data-mlb]')) render();
  });

  const tbody = document.getElementById('tbody');
  if (tbody) {
    const obs = new MutationObserver(render);
    obs.observe(tbody, { childList: true, subtree: false });
  }

  document.addEventListener('DOMContentLoaded', () => { 
    ensureUI(); 
    render(); 
    pollJobs(); 
  });
})();
