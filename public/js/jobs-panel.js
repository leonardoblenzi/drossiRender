/* Painel de processos – sempre visível; lembra estado (minimizado) via localStorage
   Suporta "badges" (pills) por conta: j.badges = [{ text, cls }] */
(function () {
  const PANEL_SEL = '#bulkJobsPanel';
  const JOBS_KEY = '__jobs_panel_v2__';
  const UI_KEY   = '__jobs_panel_ui__';  // guarda { collapsed: bool }
  const JOB_TTL = 24 * 60 * 60 * 1000; // 24h

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    s == null
      ? ''
      : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let panel = null;
  function ensurePanel() { if (!panel) panel = $(PANEL_SEL); return panel; }

  // ---------- UI state (minimizado) ----------
  let ui = { collapsed: false };
  function loadUI(){
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || '{"collapsed":false}'); }
    catch { ui = { collapsed:false }; }
    if (typeof ui.collapsed !== 'boolean') ui.collapsed = false;
  }
  function saveUI(){
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
  }

  // ---------- jobs store ----------
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

  // ---------- helpers ----------
  function normalizeBadges(badges, badge){
    const arr = [];
    if (badge && (badge.text || badge.cls)) arr.push({ text:String(badge.text||''), cls:String(badge.cls||'') });
    (Array.isArray(badges) ? badges : []).forEach(b=>{
      if (!b) return;
      arr.push({ text:String(b.text||''), cls:String(b.cls||'') });
    });
    return arr;
  }
  function renderBadges(arr){
    if (!arr || !arr.length) return '';
    return ' ' + arr.map(b=>`<span class="job-badge ${esc(b.cls||'')}">${esc(b.text||'')}</span>`).join(' ');
  }

  // ---------- CRUD ----------
  function addLocalJob({ id, title, badge, badges }) {
    loadIfNeeded();
    const jobId = id || `local|${Date.now()}|${Math.random().toString(36).slice(2,8)}`;
    cache[jobId] = {
      id: jobId,
      title: title || 'Processo',
      badges: normalizeBadges(badges, badge),
      progress: 0,
      state: 'iniciando…',
      completed: false,
      dismissed: false,
      started: Date.now(),
      updated: Date.now()
    };
    save(); show(); render();
    return jobId;
  }

  function updateLocalJob(id, { progress, state, completed, badges, badge }) {
    loadIfNeeded();
    const j = cache[id]; if (!j) return;
    if (typeof progress === 'number') j.progress = Math.max(0, Math.min(100, progress));
    if (state != null) j.state = String(state);
    if (typeof completed === 'boolean') j.completed = completed;
    if (completed == null) j.completed = (j.progress >= 100) || /conclu/i.test(j.state || '');
    const nb = normalizeBadges(badges, badge);
    if (nb.length) j.badges = nb;
    j.updated = Date.now();
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

  // ---------- UI ----------
  function render() {
    const root = ensurePanel(); if (!root) return;
    root.classList.toggle('collapsed', !!ui.collapsed);

    const rows = jobsForRender().map(j => (
`<div class="job-row${j.completed ? ' done' : ''}">
  <div class="job-title">${esc(j.title)}${renderBadges(j.badges)}</div>
  <div class="job-state">${esc(j.state || '')} – ${Math.round(j.progress)}%</div>
  <div class="job-bar"><div class="job-bar-fill" style="width:${Math.round(j.progress)}%"></div></div>
  <button class="btn ghost icon job-dismiss" data-id="${esc(j.id)}" title="Fechar">×</button>
</div>`
    )).join('');

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
    // “Fechar” apenas minimiza (painel sempre presente)
    root.querySelector('#jpClose')?.addEventListener('click', () => {
      ui.collapsed = true; saveUI(); render();
    });

    root.querySelectorAll('.job-dismiss').forEach(b => {
      b.addEventListener('click', (e)=> dismiss(e.currentTarget.dataset.id));
    });
  }

  function show(){ const r = ensurePanel(); if (r) r.classList.remove('hidden'); }
  function hide(){ const r = ensurePanel(); if (r) r.classList.add('hidden'); }

  document.addEventListener('DOMContentLoaded', () => {
    loadUI();
    loadIfNeeded();
    show();    // sempre visível
    render();
  });

  // expose
  window.JobsPanel = {
    addLocalJob,
    updateLocalJob,
    replaceId,
    dismiss,
    listActiveIds,
    show, hide
  };
})();
