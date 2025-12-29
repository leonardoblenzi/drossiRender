// public/js/admin-usuarios.js
(() => {
  const $ = (id) => document.getElementById(id);

  const tbody = $("tbody");
  const search = $("search");
  const btnClear = $("btn-clear");
  const btnCreate = $("btn-create");
  const btnRefresh = $("btn-refresh");

  const btnPrev = $("btn-prev");
  const btnNext = $("btn-next");
  const pageInfo = $("page-info");
  const rangeInfo = $("range-info");
  const countPill = $("count-pill");

  const modal = $("modal-user");
  const modalTitle = $("modal-title");
  const modalClose = $("modal-close");
  const btnCancel = $("btn-cancel");
  const btnSave = $("btn-save");

  // Wizard UI
  const wizardHead = $("wizard-head");
  const wizardStepText = $("wizard-steptext");
  const wizardStepSmall = $("wizard-stepsmall");
  const wizardBarFill = $("wizard-bar-fill");

  const step1El = $("step-1");
  const step2El = $("step-2");

  const btnWizBack = $("btn-wiz-back");
  const btnWizNext = $("btn-wiz-next");

  const wizardSummaryValue = $("wizard-summary-value");

  const fNome = $("f-nome");
  const fEmail = $("f-email");
  const fNivel = $("f-nivel");
  const fSenha = $("f-senha");
  const lblSenha = $("lbl-senha");
  const senhaHelp = $("senha-help");
  const formError = $("form-error");

  // Field errors
  const errNome = $("err-nome");
  const errEmail = $("err-email");
  const errNivel = $("err-nivel");
  const errSenha = $("err-senha");
  const errEmpresa = $("err-empresa");
  const errPapel = $("err-papel");

  // Step2 fields
  const fEmpresa = $("f-empresa");
  const fPapel = $("f-papel");

  const toast = $("toast");

  let allUsers = [];
  let filtered = [];
  let page = 1;
  const perPage = 25;

  let mode = "create"; // 'create' | 'edit'
  let editingId = null;

  // Wizard state (create only)
  let wizardStep = 1; // 1 or 2
  let empresasCache = null; // [{id,nome,...}]
  let empresasLoaded = false;

  // ===========================
  // Auth state
  // ===========================
  const auth = {
    loaded: false,
    me: null,
    uid: null,
    nivel: null,
    isMaster: false,
  };

  // ===========================
  // UI helpers
  // ===========================
  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    setTimeout(() => (toast.style.display = "none"), 2400);
  }

  function showModal() {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }
  function hideModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  function setError(msg) {
    if (!msg) {
      formError.style.display = "none";
      formError.textContent = "";
      return;
    }
    formError.style.display = "block";
    formError.textContent = msg;
  }

  function clearFieldErrors() {
    [errNome, errEmail, errNivel, errSenha, errEmpresa, errPapel].forEach(
      (el) => {
        if (el) el.textContent = "";
      }
    );
    [fNome, fEmail, fNivel, fSenha, fEmpresa, fPapel].forEach((el) => {
      if (el && el.classList) el.classList.remove("is-invalid");
    });
  }

  function setFieldError(inputEl, msgEl, msg) {
    if (msgEl) msgEl.textContent = msg || "";
    if (inputEl && inputEl.classList) {
      if (msg) inputEl.classList.add("is-invalid");
      else inputEl.classList.remove("is-invalid");
    }
  }

  function formatDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function badgeNivel(nivel) {
    const n = String(nivel || "usuario").toLowerCase();
    if (n === "admin_master") return `<span class="badge admin">MASTER</span>`;
    if (n === "administrador") return `<span class="badge admin">ADMIN</span>`;
    return `<span class="badge user">USUÁRIO</span>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ===========================
  // API helper
  // ===========================
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ===========================
  // Auth / permissions
  // ===========================
  function computeAuthFlags(mePayload) {
    const u = mePayload?.user || null;

    auth.loaded = true;
    auth.me = mePayload || null;
    auth.uid = Number(u?.uid) || null;
    auth.nivel = String(u?.nivel || "");
    auth.isMaster =
      mePayload?.is_master === true || auth.nivel === "admin_master";
  }

  async function loadMe() {
    try {
      const data = await api("/api/auth/me", { method: "GET" });

      const logged = data?.logged === true || !!data?.user;
      if (!logged) {
        window.location.href = "/login";
        return;
      }

      computeAuthFlags(data);

      // ✅ painel admin é MASTER-only
      if (!auth.isMaster) {
        window.location.href = "/nao-autorizado";
        return;
      }

      applyUiPermissions();
    } catch {
      window.location.href = "/login";
    }
  }

  function ensureNivelOptions() {
    if (!fNivel) return;

    const wanted = [
      { v: "usuario", t: "Usuário" },
      { v: "administrador", t: "Administrador" },
      { v: "admin_master", t: "Master" },
    ];

    const existing = new Set([...fNivel.options].map((o) => o.value));
    wanted.forEach((opt) => {
      if (!existing.has(opt.v)) {
        const o = document.createElement("option");
        o.value = opt.v;
        o.textContent = opt.t;
        fNivel.appendChild(o);
      }
    });
  }

  function applyUiPermissions() {
    if (btnCreate) btnCreate.style.display = "";
    ensureNivelOptions();
  }

  function isMasterRow(user) {
    return String(user?.nivel || "").toLowerCase() === "admin_master";
  }

  function isSelfRow(user) {
    return Number(user?.id) === Number(auth.uid);
  }

  function canEditUserRow(_user) {
    return !!auth.isMaster;
  }

  function canDeleteUserRow(user) {
    if (!auth.isMaster) return false;
    if (isSelfRow(user)) return false;
    if (isMasterRow(user)) return false;
    return true;
  }

  // ===========================
  // Wizard (create)
  // ===========================
  function wizardEnable(on) {
    if (!wizardHead || !btnWizNext || !btnWizBack) return;

    wizardHead.style.display = on ? "" : "none";

    // botões wizard só no create
    btnWizNext.style.display = on ? "" : "none";
    btnWizBack.style.display = "none"; // começa no passo 1

    // save no create só no passo 2 (controlado pelo step)
    btnSave.style.display = on ? "none" : "";
  }

  function setWizardStep(step) {
    wizardStep = step === 2 ? 2 : 1;

    // visibilidade steps
    step1El.style.display = wizardStep === 1 ? "" : "none";
    step2El.style.display = wizardStep === 2 ? "" : "none";

    // progress header
    if (wizardStepText) wizardStepText.textContent = `Passo ${wizardStep}/2`;
    if (wizardStepSmall) {
      wizardStepSmall.textContent =
        wizardStep === 1 ? "Dados do usuário" : "Vínculo com empresa";
    }
    if (wizardBarFill)
      wizardBarFill.style.width = wizardStep === 1 ? "50%" : "100%";

    // footer buttons
    if (wizardStep === 1) {
      btnWizBack.style.display = "none";
      btnWizNext.style.display = "";
      btnSave.style.display = "none";
    } else {
      btnWizBack.style.display = "";
      btnWizNext.style.display = "none";
      btnSave.style.display = "";
    }

    setError("");
    clearFieldErrors();

    // foco
    if (wizardStep === 1) {
      setTimeout(() => fEmail?.focus(), 0);
    } else {
      setTimeout(() => fEmpresa?.focus(), 0);
    }
  }

  function isValidEmail(email) {
    const s = String(email || "").trim();
    // simples e suficiente pro front (back valida de verdade)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function validateStep1() {
    clearFieldErrors();

    const nome = String(fNome.value || "").trim();
    const email = String(fEmail.value || "")
      .trim()
      .toLowerCase();
    const nivel = String(fNivel.value || "usuario")
      .trim()
      .toLowerCase();
    const senha = String(fSenha.value || "");

    let ok = true;

    // nome: opcional (mas se preenchido, ok)
    if (nome && nome.length < 2) {
      ok = false;
      setFieldError(fNome, errNome, "Nome muito curto.");
    }

    if (!email) {
      ok = false;
      setFieldError(fEmail, errEmail, "Informe o email.");
    } else if (!isValidEmail(email)) {
      ok = false;
      setFieldError(fEmail, errEmail, "Email inválido.");
    }

    if (!nivel) {
      ok = false;
      setFieldError(fNivel, errNivel, "Selecione o nível.");
    }

    if (mode === "create") {
      if (!senha) {
        ok = false;
        setFieldError(fSenha, errSenha, "Informe a senha.");
      } else if (senha.length < 6) {
        ok = false;
        setFieldError(
          fSenha,
          errSenha,
          "A senha deve ter no mínimo 6 caracteres."
        );
      }
    } else {
      // edit: senha opcional
      if (senha && senha.length > 0 && senha.length < 6) {
        ok = false;
        setFieldError(
          fSenha,
          errSenha,
          "A senha deve ter no mínimo 6 caracteres."
        );
      }
    }

    return ok;
  }

  function validateStep2() {
    clearFieldErrors();

    const empresaId = Number(fEmpresa.value);
    const papel = String(fPapel.value || "")
      .trim()
      .toLowerCase();
    const papelOk = ["owner", "admin", "operador"].includes(papel);

    let ok = true;

    if (!Number.isFinite(empresaId) || empresaId <= 0) {
      ok = false;
      setFieldError(fEmpresa, errEmpresa, "Selecione uma empresa.");
    }

    if (!papelOk) {
      ok = false;
      setFieldError(fPapel, errPapel, "Selecione um papel válido.");
    }

    return ok;
  }

  async function loadEmpresasIfNeeded() {
    if (empresasLoaded && Array.isArray(empresasCache)) return;

    fEmpresa.innerHTML = `<option value="">Carregando…</option>`;
    try {
      const data = await api("/api/admin/empresas", { method: "GET" });
      const list = Array.isArray(data.empresas) ? data.empresas : [];
      empresasCache = list;
      empresasLoaded = true;

      if (!list.length) {
        fEmpresa.innerHTML = `<option value="">Nenhuma empresa cadastrada</option>`;
        return;
      }

      fEmpresa.innerHTML =
        `<option value="">Selecione…</option>` +
        list
          .map(
            (e) =>
              `<option value="${Number(e.id)}">${escapeHtml(
                e.nome || `Empresa ${e.id}`
              )}</option>`
          )
          .join("");
    } catch (e) {
      empresasLoaded = false;
      empresasCache = null;
      fEmpresa.innerHTML = `<option value="">Erro ao carregar empresas</option>`;
      throw e;
    }
  }

  async function wizardNext() {
    setError("");

    if (!validateStep1()) return;

    // resumo
    const nome = String(fNome.value || "").trim();
    const email = String(fEmail.value || "")
      .trim()
      .toLowerCase();
    wizardSummaryValue.textContent = nome ? `${nome} — ${email}` : email;

    try {
      await loadEmpresasIfNeeded();
    } catch (e) {
      setError(e.message || "Erro ao carregar empresas.");
      return;
    }

    setWizardStep(2);
  }

  function wizardBack() {
    setWizardStep(1);
  }

  // ===========================
  // Filtering / pagination / render
  // ===========================
  function applyFilter() {
    const q = String(search.value || "")
      .trim()
      .toLowerCase();
    if (!q) {
      filtered = [...allUsers];
    } else {
      filtered = allUsers.filter((u) => {
        const nome = String(u.nome || "").toLowerCase();
        const email = String(u.email || "").toLowerCase();
        const nivel = String(u.nivel || "").toLowerCase();
        return (
          nome.includes(q) ||
          email.includes(q) ||
          nivel.includes(q) ||
          String(u.id).includes(q)
        );
      });
    }
    page = 1;
    render();
  }

  function paginate(list) {
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    page = Math.min(Math.max(1, page), pages);

    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const slice = list.slice(start, end);

    return { total, pages, start, end, slice };
  }

  function render() {
    const { total, pages, start, end, slice } = paginate(filtered);

    countPill.textContent = `${total} usuário${total === 1 ? "" : "s"}`;
    pageInfo.textContent = `${page} / ${pages}`;
    rangeInfo.textContent = total
      ? `Mostrando ${start + 1}–${end} de ${total}`
      : "Nenhum usuário encontrado";

    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= pages;

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Nenhum usuário encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = slice
      .map((u) => {
        const id = u.id;
        const nome = escapeHtml(u.nome || "—");
        const email = escapeHtml(u.email || "—");

        const allowEdit = canEditUserRow(u);
        const allowDelete = canDeleteUserRow(u);

        const editBtn = allowEdit
          ? `<button class="icon-btn" data-action="edit" data-id="${id}" title="Editar">✏️</button>`
          : `<button class="icon-btn" disabled title="Sem permissão">✏️</button>`;

        const deleteBtn = allowDelete
          ? `<button class="icon-btn danger" data-action="delete" data-id="${id}" title="Remover">🗑️</button>`
          : `<button class="icon-btn danger" disabled title="${
              isSelfRow(u)
                ? "Você não pode remover a si mesmo"
                : isMasterRow(u)
                ? "Evita remover MASTER por acidente"
                : "Sem permissão"
            }">🗑️</button>`;

        return `
          <tr>
            <td>${id}</td>
            <td>${nome}</td>
            <td>${email}</td>
            <td>${badgeNivel(u.nivel)}</td>
            <td>${formatDate(u.criado_em)}</td>
            <td>${formatDate(u.ultimo_login_em)}</td>
            <td>
              <div class="actions">
                ${editBtn}
                ${deleteBtn}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // ===========================
  // Data loading
  // ===========================
  async function loadUsers() {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Carregando…</td></tr>`;
    try {
      const data = await api("/api/admin/usuarios", { method: "GET" });
      allUsers = Array.isArray(data.usuarios) ? data.usuarios : [];
      filtered = [...allUsers];
      applyFilter();
      showToast("Lista atualizada.");
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Erro ao carregar usuários: ${escapeHtml(
        e.message
      )}</td></tr>`;
    }
  }

  // ===========================
  // Modal openers
  // ===========================
  function openCreate() {
    if (!auth.isMaster) {
      showToast("Somente MASTER pode cadastrar.");
      return;
    }

    mode = "create";
    editingId = null;

    modalTitle.textContent = "Cadastrar usuário";
    lblSenha.textContent = "Senha *";
    senhaHelp.textContent = "Obrigatória no cadastro.";
    fSenha.value = "";

    fNome.value = "";
    fEmail.value = "";
    ensureNivelOptions();
    fNivel.value = "usuario";

    // Step2 defaults
    if (fPapel) fPapel.value = "admin";
    if (fEmpresa) fEmpresa.value = "";

    // UI
    fNivel.disabled = false;
    fEmail.disabled = false;

    setError("");
    clearFieldErrors();

    wizardEnable(true);
    setWizardStep(1);

    showModal();
    fEmail.focus();
  }

  function openEdit(user) {
    if (!auth.isMaster) {
      showToast("Somente MASTER pode editar.");
      return;
    }

    mode = "edit";
    editingId = user.id;

    modalTitle.textContent = `Editar usuário #${user.id}`;
    lblSenha.textContent = "Nova senha (opcional)";
    senhaHelp.textContent = "Deixe vazio para manter a senha atual.";
    fSenha.value = "";

    fNome.value = user.nome || "";
    fEmail.value = user.email || "";
    ensureNivelOptions();
    fNivel.value = String(user.nivel || "usuario").toLowerCase();

    // trava próprio master
    if (
      isSelfRow(user) &&
      String(user.nivel || "").toLowerCase() === "admin_master"
    ) {
      fNivel.disabled = true;
      fEmail.disabled = true;
    } else {
      fNivel.disabled = false;
      fEmail.disabled = false;
    }

    setError("");
    clearFieldErrors();

    // EDIT não é wizard
    wizardEnable(false);
    step1El.style.display = "";
    step2El.style.display = "none";
    btnSave.style.display = "";

    showModal();
    fNome.focus();
  }

  // ===========================
  // Save / delete
  // ===========================
  async function saveUser() {
    setError("");

    if (!auth.isMaster) {
      setError("Somente MASTER pode salvar alterações.");
      return;
    }

    // validações
    if (!validateStep1()) return;

    const payload = {
      nome: String(fNome.value || "").trim() || null,
      email: String(fEmail.value || "")
        .trim()
        .toLowerCase(),
      nivel: String(fNivel.value || "usuario")
        .trim()
        .toLowerCase(),
    };

    const senha = String(fSenha.value || "");
    if (senha) payload.senha = senha;

    // CREATE: exige Step2 (empresa + papel)
    if (mode === "create") {
      // se ainda está no passo 1, empurra pro passo 2
      if (wizardStep !== 2) {
        await wizardNext();
        return;
      }

      if (!validateStep2()) return;

      payload.empresa_id = Number(fEmpresa.value);
      payload.papel = String(fPapel.value || "")
        .trim()
        .toLowerCase();
    }

    // Confirmação extra ao promover para master
    if (payload.nivel === "admin_master") {
      const ok = confirm(
        "Você está definindo este usuário como ADMIN MASTER.\n\nIsso dá acesso total ao sistema.\nDeseja continuar?"
      );
      if (!ok) return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "Salvando…";

    try {
      if (mode === "create") {
        await api("/api/admin/usuarios", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast("Usuário criado e vinculado.");
      } else {
        await api(`/api/admin/usuarios/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showToast("Usuário atualizado.");
      }

      hideModal();
      await loadUsers();
    } catch (e) {
      console.error(e);
      setError(e.message || "Erro ao salvar.");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Salvar";
      if (fNivel) fNivel.disabled = false;
      if (fEmail) fEmail.disabled = false;
    }
  }

  async function deleteUser(id) {
    if (!auth.isMaster) {
      showToast("Somente MASTER pode remover.");
      return;
    }

    const user = allUsers.find((u) => Number(u.id) === Number(id));
    if (!user) return;

    if (isSelfRow(user)) {
      alert("Você não pode remover a si mesmo.");
      return;
    }

    if (isMasterRow(user)) {
      alert(
        "Por segurança, a remoção de um MASTER não é permitida via painel."
      );
      return;
    }

    const label = `${user.email} (#${user.id})`;
    if (!confirm(`Remover o usuário ${label}?`)) return;

    try {
      await api(`/api/admin/usuarios/${id}`, { method: "DELETE" });
      showToast("Usuário removido.");
      await loadUsers();
    } catch (e) {
      console.error(e);
      alert(`Erro ao remover: ${e.message}`);
    }
  }

  // ===========================
  // Events
  // ===========================
  function bindEvents() {
    btnCreate?.addEventListener("click", openCreate);
    btnRefresh?.addEventListener("click", loadUsers);

    btnClear?.addEventListener("click", () => {
      search.value = "";
      applyFilter();
      search.focus();
    });

    search?.addEventListener("input", () => applyFilter());

    btnPrev?.addEventListener("click", () => {
      page--;
      render();
    });
    btnNext?.addEventListener("click", () => {
      page++;
      render();
    });

    modalClose?.addEventListener("click", hideModal);
    btnCancel?.addEventListener("click", hideModal);

    modal?.addEventListener("click", (e) => {
      if (e.target === modal) hideModal();
    });

    // wizard
    btnWizNext?.addEventListener("click", wizardNext);
    btnWizBack?.addEventListener("click", wizardBack);

    btnSave?.addEventListener("click", saveUser);

    tbody?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = Number(btn.getAttribute("data-id"));

      if (action === "edit") {
        const user = allUsers.find((u) => Number(u.id) === id);
        if (user) openEdit(user);
      }

      if (action === "delete") {
        deleteUser(id);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") hideModal();
      if (mode === "create" && modal.style.display === "flex") {
        // Enter no passo 1 = Próximo | Enter no passo 2 = Salvar
        if (e.key === "Enter") {
          const tag = String(e.target?.tagName || "").toLowerCase();
          const isInput =
            tag === "input" || tag === "select" || tag === "textarea";
          if (!isInput) return;

          e.preventDefault();
          if (wizardStep === 1) wizardNext();
          else saveUser();
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await loadMe(); // master-only
    await loadUsers();
  });
})();
