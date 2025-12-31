// public/js/jobs-panel.js
// Painel fixo de processos (lado direito embaixo), usado pela Central de Promoções
// API exposta em window.JobsPanel:
//   - addLocalJob({ title, accountKey?, accountLabel? }) -> jobId
//   - updateLocalJob(jobId, { progress?, state?, completed?, accountKey?, accountLabel? })
//   - mergeApiJobs(list)  // integra com JobsWatcher (criar-promocao.js / pesquisa descrição / exclusão etc.)
//   - replaceId(oldId, newId)  // troca o id de um job já exibido para outro (ex: id temporário -> process_id do backend)
//   - show()
//   - hide()

(function () {
  const PANEL_ID = "bulkJobsPanel";
  const $ = (s) => document.querySelector(s);

  // { id, title, progress, state, completed, locked, accountKey, accountLabel, dismissed, updated }
  let jobs = [];
  let panelEl = null;
  let collapsed = false;

  function ensurePanel() {
    if (!panelEl) panelEl = document.getElementById(PANEL_ID);
    return panelEl;
  }

  function clamp(n) {
    const v = Number(n ?? 0);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  function esc(s) {
    return s == null
      ? ""
      : String(s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            }[c])
        );
  }

  function normalizeStateText(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    return t;
  }

  function isTerminalCompleted(stateText) {
    const t = String(stateText || "");
    return /conclu|finaliz|completed|done|success|sucesso/i.test(t);
  }

  function isTerminalFailed(stateText) {
    const t = String(stateText || "");
    return /failed|falh|erro|error/i.test(t);
  }

  function renderBadge(job) {
    const key = (job.accountKey || "").toLowerCase();
    const label = job.accountLabel || job.accountKey || "";
    if (!key && !label) return "";
    const cls = key || "generic";
    return `<span class="pill ${esc(cls)}">${esc(label || key)}</span>`;
  }

  function render() {
    const root = ensurePanel();
    if (!root) return;

    root.classList.toggle("collapsed", !!collapsed);

    const rows = jobs
      .filter((j) => !j.dismissed)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .map((j) => {
        const pct = clamp(j.progress);
        const state = j.state ? esc(j.state) : `${pct}%`;
        return `
<div class="job-row${j.completed ? " done" : ""}">
  <div class="job-title">
    ${esc(j.title || "Processo")}
    ${renderBadge(j)}
  </div>
  <div class="job-state">${state}</div>
  <div class="job-bar">
    <div class="job-bar-fill" style="width:${pct}%;"></div>
  </div>
  <button class="btn ghost icon job-dismiss" data-id="${esc(
    j.id
  )}" title="Fechar">×</button>
</div>`;
      })
      .join("");

    root.innerHTML = `
<div class="job-head">
  <strong>Processos</strong>
  <div class="head-actions">
    <button class="btn ghost icon" id="jpToggle" title="${
      collapsed ? "Maximizar" : "Minimizar"
    }">${collapsed ? "▢" : "–"}</button>
    <button class="btn ghost icon" id="jpClose" title="Esconder">×</button>
  </div>
</div>
<div class="job-list"${collapsed ? ' style="display:none"' : ""}>
  ${rows || '<div class="muted">Sem processos.</div>'}
</div>`;

    root.querySelector("#jpToggle")?.addEventListener("click", () => {
      collapsed = !collapsed;
      render();
    });
    root.querySelector("#jpClose")?.addEventListener("click", () => {
      collapsed = true;
      render();
    });

    root.querySelectorAll(".job-dismiss").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const id = ev.currentTarget.dataset.id;
        const j = jobs.find((x) => x.id === id);
        if (j) j.dismissed = true;
        render();
      });
    });
  }

  function ensureJob(id) {
    const jobId = String(id || "").trim();
    if (!jobId) return null;

    let j = jobs.find((x) => x.id === jobId);
    if (!j) {
      j = {
        id: jobId,
        title: "Processo",
        progress: 0,
        state: "iniciando…",
        completed: false,
        locked: false, // 🔒 trava depois que concluir pra não virar "failed" por poller
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
      title: title || "Processo",
      progress: 0,
      state: "iniciando…",
      completed: false,
      locked: false,
      dismissed: false,
      accountKey: accountKey || null,
      accountLabel: accountLabel || null,
      updated: Date.now(),
    });
    show();
    render();
    return id;
  }

  // ✅ update "seguro": se já concluiu, não deixa rebaixar pra failed
  function updateLocalJob(
    id,
    { progress, state, completed, accountKey, accountLabel }
  ) {
    const j = ensureJob(id);
    if (!j) return;

    const nextProgress = typeof progress === "number" ? clamp(progress) : null;
    const nextState = state != null ? normalizeStateText(state) : null;
    const nextCompleted = typeof completed === "boolean" ? completed : null;

    // Se já está travado/concluído e veio update "failed", ignora
    if ((j.locked || j.completed) && nextState && isTerminalFailed(nextState)) {
      j.updated = Date.now();
      render();
      return;
    }

    if (nextProgress != null) j.progress = nextProgress;

    if (nextState != null) j.state = nextState;

    if (nextCompleted != null) j.completed = nextCompleted;

    if (accountKey != null) j.accountKey = accountKey;
    if (accountLabel != null) j.accountLabel = accountLabel;

    // Auto-complete por heurística
    if (nextCompleted == null) {
      const autoDone =
        j.completed ||
        j.progress >= 100 ||
        isTerminalCompleted(j.state) ||
        /conclu/i.test(j.state || "") ||
        /finaliz/i.test(j.state || "");

      if (autoDone) j.completed = true;
    }

    // Se concluiu, padroniza e trava
    if (j.completed) {
      if (j.progress < 100) j.progress = 100;
      if (!j.state || isTerminalFailed(j.state)) j.state = "concluído";
      j.locked = true;
    }

    j.updated = Date.now();
    render();
  }

  function replaceId(oldId, newId) {
    const oldStr = String(oldId || "").trim();
    const newStr = String(newId || "").trim();
    if (!newStr) return oldStr;
    if (oldStr === newStr) return newStr;

    let job = jobs.find((j) => j.id === oldStr);
    if (!job) {
      const existing = jobs.find((j) => j.id === newStr);
      if (existing) return newStr;
      return newStr;
    }

    // Se já existe um com newStr, mescla no mais recente e remove duplicado
    const dup = jobs.find((j) => j.id === newStr);
    if (dup && dup !== job) {
      // mantém o que estiver mais "completo"
      dup.title = dup.title || job.title;
      dup.progress = Math.max(dup.progress || 0, job.progress || 0);
      dup.completed = dup.completed || job.completed;
      dup.locked = dup.locked || job.locked;
      dup.state = dup.state || job.state;
      dup.updated = Date.now();
      jobs = jobs.filter((j) => j !== job);
      render();
      return newStr;
    }

    job.id = newStr;
    job.updated = Date.now();
    render();
    return newStr;
  }

  // Integra jobs vindos do backend
  function mergeApiJobs(list) {
    if (!Array.isArray(list)) return;

    list.forEach((raw) => {
      const id = String(raw.id || raw.job_id || raw.process_id || "").trim();
      if (!id) return;

      // ✅ agora aceita title OU label (seu backend parece mandar "label")
      const title =
        raw.title || raw.label || raw.name || raw.job_name || "Processo";

      // números podem vir stringados
      const processed = Number(
        raw.processed ?? raw.done ?? raw.ok ?? raw.count_ok ?? NaN
      );
      const total = Number(
        raw.total ?? raw.expected_total ?? raw.count_total ?? NaN
      );

      let pct = Number(raw.progress ?? raw.pct ?? NaN);
      if (
        !Number.isFinite(pct) &&
        Number.isFinite(processed) &&
        Number.isFinite(total) &&
        total > 0
      ) {
        pct = Math.round((processed / total) * 100);
      }
      const progress = clamp(Number.isFinite(pct) ? pct : 0);

      const stateBase = normalizeStateText(
        raw.state || raw.status || raw.result || ""
      );
      const errors = Number(
        raw.errors ?? raw.error_count ?? raw.failed ?? raw.failures ?? 0
      );
      const hasErrors = Number.isFinite(errors) && errors > 0;

      const completedFromRaw =
        raw.completed != null
          ? !!raw.completed
          : raw.done === true || raw.success === true || raw.finished === true;

      const completedFromState = isTerminalCompleted(stateBase);
      const failedFromState = isTerminalFailed(stateBase);

      const isCompleted =
        completedFromRaw || completedFromState || progress >= 100;
      const isFailed =
        (!isCompleted && failedFromState) || (isCompleted && hasErrors);

      // estado amigável
      let state = stateBase;
      if (Number.isFinite(processed) && Number.isFinite(total)) {
        state = `processando ${processed}/${total} — ${progress}%`;
      } else if (!state) {
        state = `${progress}%`;
      }

      const accountKey = raw.account?.key || raw.accountKey || null;
      const accountLabel = raw.account?.label || raw.accountLabel || null;

      const job = ensureJob(id);

      // 🔒 se já travou como concluído, não deixa regredir por polling
      if ((job.locked || job.completed) && !hasErrors && failedFromState) {
        job.updated = Date.now();
        return;
      }

      job.title = title;
      job.progress = progress;
      job.accountKey = accountKey;
      job.accountLabel = accountLabel;

      if (isCompleted) {
        job.completed = true;
        job.progress = 100;

        if (hasErrors) {
          job.state = `concluído com ${errors} erro(s)`;
          job.locked = true; // também é terminal
        } else {
          // se estado veio "failed" mas terminou sem erro, padroniza
          job.state = !stateBase || failedFromState ? "concluído" : stateBase;
          job.locked = true;
        }
      } else if (isFailed) {
        job.completed = true; // terminal
        job.state = stateBase || "falhou";
        job.locked = true;
      } else {
        job.state = state;
      }

      job.updated = Date.now();
    });

    show();
    render();
  }

  function show() {
    const root = ensurePanel();
    if (root) root.classList.remove("hidden");
  }

  function hide() {
    const root = ensurePanel();
    if (root) root.classList.add("hidden");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = ensurePanel();
    if (!root) return;
    show();
    render();
  });

  window.JobsPanel = {
    addLocalJob,
    updateLocalJob,
    mergeApiJobs,
    replaceId,
    show,
    hide,
  };
})();
