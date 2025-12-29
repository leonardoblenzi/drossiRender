// public/js/admin-empresas.js
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

  const modal = $("modal-empresa");
  const modalTitle = $("modal-title");
  const modalClose = $("modal-close");
  const btnCancel = $("btn-cancel");
  const btnSave = $("btn-save");

  const fNome = $("f-nome");
  const formError = $("form-error");
  const toast = $("toast");

  let all = [];
  let filtered = [];
  let page = 1;
  const perPage = 25;

  let mode = "create"; // create | edit
  let editingId = null;

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

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function applyFilter() {
    const q = String(search.value || "").trim().toLowerCase();
    if (!q) {
      filtered = [...all];
    } else {
      filtered = all.filter((e) => {
        const nome = String(e.nome || "").toLowerCase();
        return nome.includes(q) || String(e.id).includes(q);
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

    countPill.textContent = `${total} empresa${total === 1 ? "" : "s"}`;
    pageInfo.textContent = `${page} / ${pages}`;
    rangeInfo.textContent = total
      ? `Mostrando ${start + 1}–${end} de ${total}`
      : "Nenhuma empresa encontrada";

    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= pages;

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Nenhuma empresa encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = slice
      .map((e) => {
        const id = e.id;
        const nome = escapeHtml(e.nome || "—");
        const users = Number(e.usuarios_count || 0);
        const contas = Number(e.contas_ml_count || 0);

        return `
          <tr>
            <td>${id}</td>
            <td>${nome}</td>
            <td style="text-align:center;">${users}</td>
            <td style="text-align:center;">${contas}</td>
            <td>${formatDate(e.criado_em)}</td>
            <td>
              <div class="actions">
                <button class="icon-btn" data-action="edit" data-id="${id}" title="Editar">✏️</button>
                <button class="icon-btn danger" data-action="delete" data-id="${id}" title="Remover">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
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

  async function loadEmpresas() {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Carregando…</td></tr>`;
    try {
      const data = await api("/api/admin/empresas", { method: "GET" });
      all = Array.isArray(data.empresas) ? data.empresas : [];
      filtered = [...all];
      applyFilter();
      showToast("Lista atualizada.");
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Erro ao carregar: ${escapeHtml(
        e.message
      )}</td></tr>`;
    }
  }

  function openCreate() {
    mode = "create";
    editingId = null;

    modalTitle.textContent = "Cadastrar empresa";
    fNome.value = "";
    setError("");
    showModal();
    fNome.focus();
  }

  function openEdit(row) {
    mode = "edit";
    editingId = row.id;

    modalTitle.textContent = `Editar empresa #${row.id}`;
    fNome.value = row.nome || "";
    setError("");
    showModal();
    fNome.focus();
  }

  async function saveEmpresa() {
    setError("");

    const nome = String(fNome.value || "").trim();
    if (!nome) return setError("Informe o nome da empresa.");

    btnSave.disabled = true;
    btnSave.textContent = "Salvando…";

    try {
      const payload = { nome };

      if (mode === "create") {
        await api("/api/admin/empresas", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast("Empresa criada.");
      } else {
        await api(`/api/admin/empresas/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showToast("Empresa atualizada.");
      }

      hideModal();
      await loadEmpresas();
    } catch (e) {
      console.error(e);
      setError(e.message || "Erro ao salvar.");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Salvar";
    }
  }

  async function deleteEmpresa(id) {
    const row = all.find((x) => Number(x.id) === Number(id));
    const label = row ? `${row.nome} (#${row.id})` : `#${id}`;

    if (!confirm(`Remover a empresa ${label}?\n\nObs: Só é permitido se não tiver usuários/contas ML vinculados.`)) return;

    try {
      await api(`/api/admin/empresas/${id}`, { method: "DELETE" });
      showToast("Empresa removida.");
      await loadEmpresas();
    } catch (e) {
      console.error(e);
      alert(`Erro ao remover: ${e.message}`);
    }
  }

  function bindEvents() {
    btnCreate.addEventListener("click", openCreate);
    btnRefresh.addEventListener("click", loadEmpresas);

    btnClear.addEventListener("click", () => {
      search.value = "";
      applyFilter();
      search.focus();
    });

    search.addEventListener("input", applyFilter);

    btnPrev.addEventListener("click", () => {
      page--;
      render();
    });
    btnNext.addEventListener("click", () => {
      page++;
      render();
    });

    modalClose.addEventListener("click", hideModal);
    btnCancel.addEventListener("click", hideModal);
    btnSave.addEventListener("click", saveEmpresa);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal();
    });

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = Number(btn.getAttribute("data-id"));

      if (action === "edit") {
        const row = all.find((x) => Number(x.id) === id);
        if (row) openEdit(row);
      }

      if (action === "delete") deleteEmpresa(id);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") hideModal();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadEmpresas();
  });
})();
