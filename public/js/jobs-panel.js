// jobs-panel.js (versão enxuta)
// Painel fixo de processos (lado direito embaixo), usado pela Central de Promoções
// API exposta em window.JobsPanel:
//   - addLocalJob({ title, accountKey?, accountLabel? }) -> jobId
//   - updateLocalJob(jobId, { progress?, state?, completed? })
//   - mergeApiJobs(list)  // integra com JobsWatcher (criar-promocao.js)
//   - show()
//   - hide()

(function () {
  const PANEL_ID = 'bulkJobsPanel';

  const $ = (s) => document.querySelector(s);

  let jobs = [];          // { id, title, progress, state, completed, accountKey, accountLabel }
  let panelEl = null;
  let collapsed = false;  // modo minimizado (só cabeçalho visível)

  function ensurePanel() {
    if (!panelEl) {
      panelEl = document.getElementById(PANEL_ID);
    }
    return panelEl;
  }

  function clamp(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function esc(s) {
    return s == null
      ? ''
      : String(s).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[c]));
  }

  function renderBadge(job) {
    const key = (job.accountKey || '').toLowerCase();
    const label = job.accountLabel || job.accountKey || '';
    if (!key && !label) return '';
    const cls = key || 'generic';
    return `<span class="pill ${esc(cls)}">${esc(label || key)}</span>`;
  }

  function render() {
    const root = ensurePanel();
    if (!root) return;

    root.classList.toggle('collapsed', !!collapsed);

    const rows = jobs
      .filter((j) => !j.dismissed)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .map((j) => {
        const pct = clamp(j.progress);
        const state = j.state ? esc(j.state) : `${pct}%`;
        return `
<div class="job-row${j.completed ? ' done' : ''}">
  <div class="job-title">
    ${esc(j.title || 'Processo')}
    ${renderBadge(j)}
  </div>
  <div class="job-state">${state}</div>
  <div class="job-bar">
    <div class="job-bar-fill" style="width:${pct}%;"></div>
  </div>
  <button class="btn ghost icon job-dismiss" data-id="${esc(j.id)}" title="Fechar">×</button>
</div>`;
      })
      .join('');

    root.innerHTML = `
<div class="job-head">
  <strong>Processos</strong>
  <div class="head-actions">
    <button class="btn ghost icon" id="jpToggle" title="${
      collapsed ? 'Maximizar' : 'Minimizar'
    }">${collapsed ? '▢' : '–'}</button>
    <button class="btn ghost icon" id="jpClose" title="Esconder">×</button>
  </div>
</div>
<div class="job-list"${collapsed ? ' style="display:none"' : ''}>
  ${rows || '<div class="muted">Sem processos.</div>'}
</div>`;

    // Ações do cabeçalho
    root.querySelector('#jpToggle')?.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
    });
    root.querySelector('#jpClose')?.addEventListener('click', () => {
      collapsed = true;
      render();
    });

    // Botão de fechar por linha
    root.querySelectorAll('.job-dismiss').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        const id = ev.currentTarget.dataset.id;
        const j = jobs.find((x) => x.id === id);
        if (j) j.dismissed = true;
        render();
      });
    });
  }

  function ensureJob(id) {
    let j = jobs.find((x) => x.id === id);
    if (!j) {
      j = {
        id,
        title: 'Processo',
        progress: 0,
        state: 'iniciando…',
        completed: false,
        dismissed: false,
        updated: Date.now(),
      };
      jobs.push(j);
    }
    return j;
  }

  function addLocalJob({ title, accountKey, accountLabel }) {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobs.push({
      id,
      title: title || 'Processo',
      progress: 0,
      state: 'iniciando…',
      completed: false,
      dismissed: false,
      accountKey: accountKey || null,
      accountLabel: accountLabel || null,
      updated: Date.now(),
    });
    show();
    render();
    return id;
  }

  function updateLocalJob(id, { progress, state, completed, accountKey, accountLabel }) {
    const j = ensureJob(id);
    if (typeof progress === 'number') j.progress = clamp(progress);
    if (state != null) j.state = String(state);
    if (typeof completed === 'boolean') j.completed = completed;
    if (accountKey != null) j.accountKey = accountKey;
    if (accountLabel != null) j.accountLabel = accountLabel;
    if (completed == null) {
      j.completed =
        j.completed ||
        j.progress >= 100 ||
        /conclu/i.test(j.state || '') ||
        /finaliz/i.test(j.state || '');
    }
    j.updated = Date.now();
    render();
  }

  // Integra jobs vindos do backend
  function mergeApiJobs(list) {
    if (!Array.isArray(list)) return;
    list.forEach((raw) => {
      const id = String(raw.id || raw.job_id || '').trim();
      if (!id) return;
      const title = raw.title || 'Processo';
      const processed =
        Number(raw.processed ?? raw.done ?? raw.ok ?? NaN);
      const total =
        Number(raw.total ?? raw.expected_total ?? NaN);

      let pct = raw.progress ?? raw.pct;
      if (
        !Number.isFinite(pct) &&
        Number.isFinite(processed) &&
        Number.isFinite(total) &&
        total > 0
      ) {
        pct = Math.round((processed / total) * 100);
      }
      const progress = clamp(pct ?? 0);

      let state = raw.state || raw.status || '';
      if (Number.isFinite(processed) && Number.isFinite(total)) {
        state = `processando ${processed}/${total} — ${progress}%`;
      } else if (!state) {
        state = `${progress}%`;
      }

      const accountKey = raw.account?.key || raw.accountKey || null;
      const accountLabel = raw.account?.label || raw.accountLabel || null;

      const job = ensureJob(id);
      job.title = title;
      job.progress = progress;
      job.state = state;
      job.accountKey = accountKey;
      job.accountLabel = accountLabel;
      job.completed =
        raw.completed != null
          ? !!raw.completed
          : job.completed || progress >= 100;
      job.updated = Date.now();
    });
    show();
    render();
  }

  function show() {
    const root = ensurePanel();
    if (root) root.classList.remove('hidden');
  }

  function hide() {
    const root = ensurePanel();
    if (root) root.classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = ensurePanel();
    if (!root) return;
    show();
    render();
  });

  window.JobsPanel = {
    addLocalJob,
    updateLocalJob,
    mergeApiJobs,
    show,
    hide,
  };
})();
