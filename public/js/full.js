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

  // ✅ badge opcional: mostra "Modo seleção" quando tiver itens selecionados
  const selectionBadge = qs("#selectionModeBadge") || qs("#badgeSelectionMode");

  // ✅ NOVO (com fallback para não quebrar se ainda não alterou o HTML)
  const syncBtn = qs("#syncBtn") || qs("#reloadBtn");
  const deleteSelectedBtn =
    qs("#deleteSelectedBtn") || qs("#removeSelectedBtn");

  const addProductBtn = qs("#addProductBtn");
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

  // ✅ Última atualização (fallback: cria um span ao lado do itemsInfo se não existir no HTML)
  const lastUpdateEl =
    qs("#lastUpdateInfo") ||
    qs("#lastSyncInfo") ||
    qs("[data-last-update]") ||
    (() => {
      if (!itemsInfo) return null;
      const span = document.createElement("span");
      span.id = "lastUpdateInfo";
      span.className = "ms-2 text-muted small";
      span.textContent = ""; // preenchido depois
      itemsInfo.parentNode?.insertBefore(span, itemsInfo.nextSibling);
      return span;
    })();

  // State
  let state = {
    page: 1,
    pageSize: Number(pageSizeSelect?.value || 25),
    q: "",
    status: "all",
    paging: { page: 1, pages: 1, total: 0, pageSize: 25 },
    rows: [],
    selected: new Set(), // mlbs
    mlbIndex: new Set(), // cache leve de MLBS já vistos (para anti-duplicado no front)
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

  function fmtDateTime(ts) {
    try {
      const d = ts instanceof Date ? ts : new Date(ts);
      if (!d || isNaN(d.getTime())) return "";
      return d.toLocaleString("pt-BR", { hour12: false });
    } catch {
      return "";
    }
  }

  function setLastUpdate(ts) {
    if (!lastUpdateEl) return;
    const label = fmtDateTime(ts);
    lastUpdateEl.textContent = label ? `Última atualização em: ${label}` : "";
  }

  function badgeForStatus(s) {
    const st = String(s || "").toLowerCase();
    if (st === "active") return ["Ativo", "badge-ok"];
    if (st === "no_stock") return ["Sem estoque", "badge-warn"];
    if (st === "intransfer") return ["Transferência", "badge-warn"];
    if (st === "ineligible") return ["Inelegível", "badge-muted"];
    return [s || "-", "badge-muted"];
  }

  async function safeReadBody(resp) {
    try {
      return (await resp.text()) || "";
    } catch {
      return "";
    }
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

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const body = await safeReadBody(r);

    // Se vier HTML (redirect silencioso pra /login ou /select-conta), estoura erro claro
    const looksHtml =
      body.trim().startsWith("<!DOCTYPE") || body.trim().startsWith("<html");

    if (!r.ok) {
      if (looksHtml) {
        throw new Error(
          `HTTP ${r.status} (HTML/redirect). Verifique login/conta/permissão.`
        );
      }
      try {
        const data = ct.includes("application/json") ? JSON.parse(body) : {};
        throw new Error(
          data?.message || data?.error || `Erro HTTP ${r.status}`
        );
      } catch {
        throw new Error(`Erro HTTP ${r.status}: ${body.slice(0, 200)}`.trim());
      }
    }

    if (!ct.includes("application/json")) {
      // ok mas não é JSON
      return {};
    }

    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
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

  function updateSelectionBadge() {
    if (!selectionBadge) return;
    const on = state.selected.size > 0;
    selectionBadge.classList.toggle("d-none", !on);
    // opcional: contador no badge
    const countEl = selectionBadge.querySelector("[data-selected-count]");
    if (countEl) countEl.textContent = String(state.selected.size);
  }

  function updateBulkButtonsState() {
    // Selecionar página: desabilita se não tem rows na página
    if (selectPageBtn) selectPageBtn.disabled = !state.rows.length;

    // Limpar seleção / Excluir selecionados: desabilita se não tem seleção
    const hasSel = state.selected.size > 0;
    if (clearSelectionBtn) clearSelectionBtn.disabled = !hasSel;
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = !hasSel;

    updateSelectionBadge();
  }

  function updateChips() {
    if (chipTotal) chipTotal.textContent = `${state.paging.total || 0} itens`;
    if (chipSelected)
      chipSelected.textContent = `${state.selected.size} selecionados`;
    updateBulkButtonsState();
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set("page", String(state.page));
    params.set("pageSize", String(state.pageSize));
    if (state.q) params.set("q", state.q);
    if (state.status) params.set("status", state.status);
    return `/api/full/anuncios?${params.toString()}`;
  }

  function extractLastUpdateFromListResponse(data) {
    // tolerante a nomes diferentes no backend
    return (
      data?.last_sync_at ||
      data?.lastSyncAt ||
      data?.last_update_at ||
      data?.lastUpdateAt ||
      data?.meta?.last_sync_at ||
      data?.meta?.lastSyncAt ||
      data?.meta?.last_update_at ||
      data?.meta?.lastUpdateAt ||
      data?.paging?.last_sync_at ||
      data?.paging?.lastSyncAt ||
      null
    );
  }

  async function fetchList() {
    setLoading(true);
    try {
      const data = await getJSON(buildQuery());
      state.rows = data.results || [];
      state.paging = data.paging || state.paging;

      // cache leve de MLBS conhecidos (para bloquear duplicado no front)
      state.rows.forEach(
        (r) => r?.mlb && state.mlbIndex.add(String(r.mlb).toUpperCase())
      );

      if (itemsInfo) itemsInfo.textContent = `${state.paging.total || 0} itens`;

      const last = extractLastUpdateFromListResponse(data);
      if (last) setLastUpdate(last);

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
      // ✅ agora são 13 colunas no total (com Vendas Total + Vendas 40d)
      tbody.innerHTML = `
        <tr>
          <td colspan="13" class="text-center py-5 text-muted">
            <div class="mb-2"><i class="bi bi-inbox" style="font-size:32px;"></i></div>
            Nenhum produto encontrado
          </td>
        </tr>
      `;
      if (selectAllCheckbox) selectAllCheckbox.checked = false;
      updateBulkButtonsState();
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

        // ✅ Vendas (Total) e Vendas 40d separados
        const soldTotal = row.sold_total ?? row.soldTotal ?? 0;
        const sold40 = row.sold_40d ?? row.sold40d ?? 0;

        const imp40 =
          row.impressions_40d ?? row.impressions40d ?? row.impressions ?? 0;
        const clk40 = row.clicks_40d ?? row.clicks40d ?? row.clicks ?? 0;

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

          <td class="col-price">${fmtMoney(row.price)}</td>

          <td class="col-qty"><span class="fw-bold">${
            row.stock_full ?? 0
          }</span></td>

          <td class="col-sold-total">${soldTotal}</td>
          <td class="col-sold-40d">${sold40}</td>

          <td class="col-impr">${imp40}</td>

          <td class="col-clicks">${clk40}</td>

          <td class="col-status">
            <span class="badge-soft ${cls}">${label}</span>
          </td>

          <td class="col-actions">
            <div class="d-flex gap-2">
              <button class="btn btn-outline-primary btn-sm btn-pill btn-sync-one" data-mlb="${mlb}" title="Sincronizar item">
                <i class="bi bi-arrow-repeat"></i>
              </button>
              <button class="btn btn-outline-danger btn-sm btn-pill btn-del-one" data-mlb="${mlb}" title="Excluir item">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    // header checkbox (selecionar todos da página)
    if (selectAllCheckbox) {
      const allOnPage = state.rows.every((r) => state.selected.has(r.mlb));
      selectAllCheckbox.checked = allOnPage;
    }

    // binds
    qsa(".row-check", tbody).forEach((el) => {
      el.addEventListener("change", () => {
        const mlb = el.getAttribute("data-mlb");
        if (!mlb) return;

        if (el.checked) state.selected.add(mlb);
        else state.selected.delete(mlb);

        updateChips();

        if (selectAllCheckbox) {
          selectAllCheckbox.checked = state.rows.every((r) =>
            state.selected.has(r.mlb)
          );
        }
      });
    });

    qsa(".btn-sync-one", tbody).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mlb = btn.getAttribute("data-mlb");
        if (!mlb) return;
        await syncMlbs([mlb]);
      });
    });

    qsa(".btn-del-one", tbody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const mlb = btn.getAttribute("data-mlb");
        if (!mlb) return;
        openRemoveModal([mlb]);
      });
    });

    updateBulkButtonsState();
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

  // ✅ anti-duplicado no front (local + checagem leve no backend via list)
  async function checkMlbAlreadyExists(mlb) {
    const up = String(mlb || "")
      .trim()
      .toUpperCase();
    if (!up) return false;

    // 1) cache local (páginas já vistas)
    if (state.mlbIndex.has(up)) return true;

    // 2) página atual
    if (state.rows.some((r) => String(r?.mlb || "").toUpperCase() === up)) {
      state.mlbIndex.add(up);
      return true;
    }

    // 3) checagem leve no backend (evita duplicar em outra página)
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("pageSize", "1");
      params.set("q", up);
      params.set("status", "all");

      const data = await getJSON(`/api/full/anuncios?${params.toString()}`);
      const found = (data?.results || []).some(
        (r) => String(r?.mlb || "").toUpperCase() === up
      );

      if (found) state.mlbIndex.add(up);
      return found;
    } catch {
      // se falhar a checagem, deixa o backend decidir (unique constraint / 409)
      return false;
    }
  }

  // ✅ Sync de mlbs (modo normal) | se mlbs for null/undefined -> sync geral (DB)
  async function syncMlbs(mlbs) {
    try {
      setLoading(true);

      const body = Array.isArray(mlbs) ? { mlbs } : {};
      const data = await getJSON("/api/full/anuncios/sync", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const last =
        data?.last_sync_at ||
        data?.lastSyncAt ||
        data?.meta?.last_sync_at ||
        data?.meta?.lastSyncAt ||
        null;
      if (last) setLastUpdate(last);
    } catch (e) {
      alert(`Falha ao sincronizar: ${e.message}`);
    } finally {
      setLoading(false);
    }

    // Recarrega a lista (fetchList controla overlay)
    await fetchList();
  }

  function openRemoveModal(mlbs) {
    if (!confirmRemoveModal) {
      if (!confirm(`Excluir ${mlbs.length} item(ns)?`)) return;
      (async () => {
        setLoading(true);
        try {
          await getJSON("/api/full/anuncios/bulk-delete", {
            method: "POST",
            body: JSON.stringify({ mlbs }),
          });
          mlbs.forEach((m) => state.selected.delete(m));
          await fetchList();
        } catch (e) {
          alert(`Erro ao excluir: ${e.message}`);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    removeProductError?.classList.add("d-none");
    if (removeProductError) removeProductError.textContent = "";
    if (removeCountEl) removeCountEl.textContent = String(mlbs.length);

    confirmRemoveBtn.onclick = async () => {
      setLoading(true);
      try {
        await getJSON("/api/full/anuncios/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ mlbs }),
        });

        mlbs.forEach((m) => state.selected.delete(m));
        confirmRemoveModal.hide();
        await fetchList();
      } catch (e) {
        if (removeProductError) {
          removeProductError.textContent = e.message;
          removeProductError.classList.remove("d-none");
        } else {
          alert(e.message);
        }
      } finally {
        setLoading(false);
      }
    };

    confirmRemoveModal.show();
  }

  function exportCSV() {
    const headers = [
      "MLB",
      "SKU",
      "Título",
      "Inventory ID",
      "Preço",
      "Qtd Full",
      "Vendas (Total)",
      "Vendas 40d",
      "Impressões 40d",
      "Cliques 40d",
      "Status",
    ];

    const rows = state.rows.map((r) => [
      r.mlb,
      r.sku || "",
      (r.title || "").replaceAll('"', '""'),
      r.inventory_id || "",
      r.price ?? "",
      r.stock_full ?? 0,
      r.sold_total ?? r.soldTotal ?? 0,
      r.sold_40d ?? r.sold40d ?? 0,
      r.impressions_40d ?? r.impressions40d ?? r.impressions ?? 0,
      r.clicks_40d ?? r.clicks40d ?? r.clicks ?? 0,
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

  // ✅ BOTÃO PRINCIPAL: SINCRONIZAR
  // - Se houver seleção -> sincroniza seleção
  // - Sem seleção -> sincroniza TODOS do DB (backend)
  syncBtn?.addEventListener("click", async () => {
    if (state.selected.size) {
      await syncMlbs(Array.from(state.selected));
      return;
    }
    await syncMlbs(); // sem mlbs => sync geral (DB)
  });

  exportBtn?.addEventListener("click", exportCSV);

  addProductBtn?.addEventListener("click", () => {
    addProductError?.classList.add("d-none");
    addProductSuccess?.classList.add("d-none");
    addProductForm?.reset();
    addProductModal?.show();
  });

  addProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    addProductError?.classList.add("d-none");
    addProductSuccess?.classList.add("d-none");

    const mlb = String(mlbInput?.value || "")
      .trim()
      .toUpperCase();
    if (!mlb.startsWith("MLB")) {
      if (addProductError) {
        addProductError.textContent = "MLB inválido.";
        addProductError.classList.remove("d-none");
      }
      return;
    }

    // ✅ bloqueia duplicado no front (e ainda deixa o backend garantir)
    const exists = await checkMlbAlreadyExists(mlb);
    if (exists) {
      if (addProductError) {
        addProductError.textContent =
          "Esse MLB já está cadastrado na lista FULL.";
        addProductError.classList.remove("d-none");
      }
      return;
    }

    if (addProductSubmitBtn) addProductSubmitBtn.disabled = true;
    try {
      await getJSON("/api/full/anuncios", {
        method: "POST",
        body: JSON.stringify({ mlb }),
      });

      // atualiza cache local
      state.mlbIndex.add(mlb);

      if (addProductSuccess) {
        addProductSuccess.textContent = "Produto adicionado com sucesso.";
        addProductSuccess.classList.remove("d-none");
      }

      state.page = 1;
      await fetchList();
      setTimeout(() => addProductModal?.hide(), 500);
    } catch (err) {
      if (addProductError) {
        addProductError.textContent = err.message;
        addProductError.classList.remove("d-none");
      } else {
        alert(err.message);
      }
    } finally {
      if (addProductSubmitBtn) addProductSubmitBtn.disabled = false;
    }
  });

  selectAllCheckbox?.addEventListener("change", () => {
    if (selectAllCheckbox.checked) selectAllOnPage();
    else {
      currentPageMlbs().forEach((mlb) => state.selected.delete(mlb));
      updateChips();
      renderTable();
    }
  });

  // ✅ botões novos (se existirem)
  selectPageBtn?.addEventListener("click", () => selectAllOnPage());
  clearSelectionBtn?.addEventListener("click", () => clearSelection());

  // ✅ BOTÃO EXCLUIR (selecionados)
  deleteSelectedBtn?.addEventListener("click", () => {
    if (!state.selected.size) {
      alert("Selecione ao menos um item para excluir.");
      return;
    }
    openRemoveModal(Array.from(state.selected));
  });

  // Init
  (async () => {
    await loadWhoAmI();
    await fetchList();
    updateChips();
  })();
})();
