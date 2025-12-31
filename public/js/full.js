// /public/js/full.js
(() => {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  const loadingOverlay = qs("#loadingOverlay");
  const tbody = qs("#productsTableBody");
  const pagination = qs("#pagination");

  const searchInput = qs("#searchInput");
  const pageSizeSelect = qs("#pageSizeSelect");
  const statusFilter = qs("#statusFilter");

  const chipTotal = qs("#chipTotal");
  const chipSelected = qs("#chipSelected");
  const itemsInfo = qs("#itemsInfo");

  const selectAllCheckbox = qs("#selectAllCheckbox");
  const selectPageBtn = qs("#selectPageBtn");
  const clearSelectionBtn = qs("#clearSelectionBtn");
  const syncSelectedBtn = qs("#syncSelectedBtn");
  const removeSelectedBtn = qs("#removeSelectedBtn");

  const addProductBtn = qs("#addProductBtn");
  const reloadBtn = qs("#reloadBtn");
  const exportBtn = qs("#exportBtn");

  const currentAccountEls = [
    qs("#currentAccount"),
    qs("#account-current"),
  ].filter(Boolean);

  // Modals
  const addProductModalEl = qs("#addProductModal");
  const addProductModal = addProductModalEl
    ? new bootstrap.Modal(addProductModalEl)
    : null;
  const addProductForm = qs("#addProductForm");
  const mlbInput = qs("#mlbInput");
  const addProductError = qs("#addProductError");
  const addProductSuccess = qs("#addProductSuccess");
  const addProductSubmitBtn = qs("#addProductSubmitBtn");

  const confirmRemoveModalEl = qs("#confirmRemoveModal");
  const confirmRemoveModal = confirmRemoveModalEl
    ? new bootstrap.Modal(confirmRemoveModalEl)
    : null;
  const removeCountEl = qs("#removeCount");
  const removeProductError = qs("#removeProductError");
  const confirmRemoveBtn = qs("#confirmRemoveBtn");

  // State
  let state = {
    page: 1,
    pageSize: Number(pageSizeSelect?.value || 25),
    q: "",
    status: "all",
    paging: { page: 1, pages: 1, total: 0, pageSize: 25 },
    rows: [],
    selected: new Set(), // mlbs
  };

  function setLoading(on) {
    if (!loadingOverlay) return;
    loadingOverlay.style.display = on ? "flex" : "none";
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function badgeForStatus(s) {
    const st = String(s || "").toLowerCase();
    if (st === "active") return ["Ativo", "badge-ok"];
    if (st === "no_stock") return ["Sem estoque", "badge-warn"];
    if (st === "intransfer") return ["Transferência", "badge-warn"];
    if (st === "ineligible") return ["Inelegível", "badge-muted"];
    return [s || "-", "badge-muted"];
  }

  async function getJSON(url, opts = {}) {
    const r = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...opts,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(data?.message || data?.error || `Erro HTTP ${r.status}`);
    return data;
  }

  async function loadWhoAmI() {
    try {
      const data = await getJSON("/api/account/whoami");
      const label =
        data?.accountLabel || data?.accountKey || "Conta selecionada";
      currentAccountEls.forEach((el) => (el.textContent = label));
    } catch {
      currentAccountEls.forEach((el) => (el.textContent = "Nenhuma"));
    }
  }

  function updateChips() {
    chipTotal.textContent = `${state.paging.total || 0} itens`;
    chipSelected.textContent = `${state.selected.size} selecionados`;
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set("page", String(state.page));
    params.set("pageSize", String(state.pageSize));
    if (state.q) params.set("q", state.q);
    if (state.status) params.set("status", state.status);
    return `/api/full/anuncios?${params.toString()}`;
  }

  async function fetchList() {
    setLoading(true);
    try {
      const data = await getJSON(buildQuery());
      state.rows = data.results || [];
      state.paging = data.paging || state.paging;
      itemsInfo.textContent = `${state.paging.total || 0} itens`;
      renderTable();
      renderPagination();
      updateChips();
    } finally {
      setLoading(false);
    }
  }

  function renderTable() {
    if (!tbody) return;

    if (!state.rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-5 text-muted">
            <div class="mb-2"><i class="bi bi-inbox" style="font-size:32px;"></i></div>
            Nenhum produto encontrado
          </td>
        </tr>
      `;
      selectAllCheckbox.checked = false;
      return;
    }

    tbody.innerHTML = state.rows
      .map((row) => {
        const mlb = row.mlb;
        const checked = state.selected.has(mlb) ? "checked" : "";
        const [label, cls] = badgeForStatus(row.status);

        const img = row.image_url
          ? `<img class="product-img" src="${row.image_url}" alt="" loading="lazy">`
          : `<div class="product-img d-flex align-items-center justify-content-center"><i class="bi bi-image text-muted"></i></div>`;

        return `
        <tr data-mlb="${mlb}">
          <td class="col-check">
            <input type="checkbox" class="form-check-input row-check" data-mlb="${mlb}" ${checked}>
          </td>
          <td class="col-img">${img}</td>
          <td class="col-mlb">
            <div class="fw-bold">${mlb}</div>
            <div class="small text-muted text-truncate" style="max-width:360px;">${
              row.title || "-"
            }</div>
          </td>
          <td class="col-sku">${row.sku || "-"}</td>
          <td class="col-qty"><span class="fw-bold">${
            row.stock_full ?? 0
          }</span></td>
          <td class="col-sold">${row.sold_total ?? 0}</td>
          <td class="col-price">${fmtMoney(row.price)}</td>
          <td class="col-status">
            <span class="badge-soft ${cls}">${label}</span>
          </td>
          <td class="col-actions">
            <div class="d-flex gap-2">
              <button class="btn btn-outline-primary btn-sm btn-pill btn-sync-one" data-mlb="${mlb}">
                <i class="bi bi-arrow-repeat"></i>
              </button>
              <button class="btn btn-outline-danger btn-sm btn-pill btn-del-one" data-mlb="${mlb}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    // header checkbox (selecionar todos da página)
    const allOnPage = state.rows.every((r) => state.selected.has(r.mlb));
    selectAllCheckbox.checked = allOnPage;

    // binds
    qsa(".row-check", tbody).forEach((el) => {
      el.addEventListener("change", () => {
        const mlb = el.getAttribute("data-mlb");
        if (el.checked) state.selected.add(mlb);
        else state.selected.delete(mlb);
        updateChips();
        selectAllCheckbox.checked = state.rows.every((r) =>
          state.selected.has(r.mlb)
        );
      });
    });

    qsa(".btn-sync-one", tbody).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mlb = btn.getAttribute("data-mlb");
        await syncMlbs([mlb]);
      });
    });

    qsa(".btn-del-one", tbody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const mlb = btn.getAttribute("data-mlb");
        openRemoveModal([mlb]);
      });
    });
  }

  function renderPagination() {
    if (!pagination) return;
    const { page, pages } = state.paging;

    const mk = (p, label, active = false, disabled = false) => `
      <li class="page-item ${active ? "active" : ""} ${
      disabled ? "disabled" : ""
    }">
        <a class="page-link" href="#" data-page="${p}">${label}</a>
      </li>
    `;

    let html = "";
    html += mk(page - 1, "‹", false, page <= 1);

    const start = Math.max(1, page - 2);
    const end = Math.min(pages, page + 2);

    for (let p = start; p <= end; p++) {
      html += mk(p, String(p), p === page, false);
    }

    html += mk(page + 1, "›", false, page >= pages);

    pagination.innerHTML = html;

    qsa("a.page-link", pagination).forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const p = Number(a.getAttribute("data-page"));
        if (!Number.isFinite(p)) return;
        if (p < 1 || p > state.paging.pages) return;
        state.page = p;
        fetchList();
      });
    });
  }

  function currentPageMlbs() {
    return state.rows.map((r) => r.mlb);
  }

  function clearSelection() {
    state.selected.clear();
    updateChips();
    renderTable();
  }

  function selectAllOnPage() {
    currentPageMlbs().forEach((mlb) => state.selected.add(mlb));
    updateChips();
    renderTable();
  }

  async function syncMlbs(mlbs) {
    setLoading(true);
    try {
      await getJSON("/api/full/anuncios/sync", {
        method: "POST",
        body: JSON.stringify({ mlbs }),
      });
      await fetchList();
    } catch (e) {
      alert(`Falha ao atualizar: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function openRemoveModal(mlbs) {
    removeProductError.classList.add("d-none");
    removeProductError.textContent = "";
    removeCountEl.textContent = String(mlbs.length);
    confirmRemoveBtn.onclick = async () => {
      setLoading(true);
      try {
        await getJSON("/api/full/anuncios/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ mlbs }),
        });

        // remove da seleção
        mlbs.forEach((m) => state.selected.delete(m));
        confirmRemoveModal.hide();
        await fetchList();
      } catch (e) {
        removeProductError.textContent = e.message;
        removeProductError.classList.remove("d-none");
      } finally {
        setLoading(false);
      }
    };

    confirmRemoveModal.show();
  }

  function exportCSV() {
    // exporta a página atual (simples e rápido)
    const headers = [
      "MLB",
      "SKU",
      "Título",
      "Inventory ID",
      "Preço",
      "Qtd Full",
      "Vendas",
      "Status",
    ];
    const rows = state.rows.map((r) => [
      r.mlb,
      r.sku || "",
      (r.title || "").replaceAll('"', '""'),
      r.inventory_id || "",
      r.price ?? "",
      r.stock_full ?? 0,
      r.sold_total ?? 0,
      r.status || "",
    ]);

    const csv = [
      headers.join(";"),
      ...rows.map((arr) => arr.map((x) => `"${String(x ?? "")}"`).join(";")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `full_produtos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Events
  let searchTimer = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = String(searchInput.value || "").trim();
      state.page = 1;
      fetchList();
    }, 250);
  });

  pageSizeSelect?.addEventListener("change", () => {
    state.pageSize = Number(pageSizeSelect.value || 25);
    state.page = 1;
    fetchList();
  });

  statusFilter?.addEventListener("change", () => {
    state.status = String(statusFilter.value || "all");
    state.page = 1;
    fetchList();
  });

  reloadBtn?.addEventListener("click", async () => {
    // “premium” = recarregar sincroniza a página atual (para não explodir rate limit)
    const mlbs = currentPageMlbs();
    if (!mlbs.length) return fetchList();
    await syncMlbs(mlbs);
  });

  exportBtn?.addEventListener("click", exportCSV);

  addProductBtn?.addEventListener("click", () => {
    addProductError.classList.add("d-none");
    addProductSuccess.classList.add("d-none");
    addProductForm.reset();
    addProductModal.show();
  });

  addProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    addProductError.classList.add("d-none");
    addProductSuccess.classList.add("d-none");

    const mlb = String(mlbInput.value || "")
      .trim()
      .toUpperCase();
    if (!mlb.startsWith("MLB")) {
      addProductError.textContent = "MLB inválido.";
      addProductError.classList.remove("d-none");
      return;
    }

    addProductSubmitBtn.disabled = true;
    try {
      await getJSON("/api/full/anuncios", {
        method: "POST",
        body: JSON.stringify({ mlb }),
      });

      addProductSuccess.textContent =
        "Produto adicionado/sincronizado com sucesso.";
      addProductSuccess.classList.remove("d-none");

      // refresh
      state.page = 1;
      await fetchList();
      setTimeout(() => addProductModal.hide(), 500);
    } catch (err) {
      addProductError.textContent = err.message;
      addProductError.classList.remove("d-none");
    } finally {
      addProductSubmitBtn.disabled = false;
    }
  });

  selectAllCheckbox?.addEventListener("change", () => {
    if (selectAllCheckbox.checked) selectAllOnPage();
    else {
      // remove só os da página
      currentPageMlbs().forEach((mlb) => state.selected.delete(mlb));
      updateChips();
      renderTable();
    }
  });

  selectPageBtn?.addEventListener("click", selectAllOnPage);
  clearSelectionBtn?.addEventListener("click", clearSelection);

  syncSelectedBtn?.addEventListener("click", async () => {
    if (!state.selected.size) return;
    await syncMlbs(Array.from(state.selected));
  });

  removeSelectedBtn?.addEventListener("click", () => {
    if (!state.selected.size) return;
    openRemoveModal(Array.from(state.selected));
  });

  // Init
  (async () => {
    await loadWhoAmI();
    await fetchList();
  })();
})();
