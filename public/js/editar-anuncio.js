// js/editar-anuncio.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ----------------------------
  // Overlay
  // ----------------------------
  const overlay = $("loadingOverlay");
  const showOverlay = () => overlay && overlay.classList.add("show");
  const hideOverlay = () => overlay && overlay.classList.remove("show");

  // ----------------------------
  // Utils
  // ----------------------------
  function esc(s) {
    return String(s ?? "").replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
    );
  }

  function nowStr() {
    return new Date().toLocaleString("pt-BR");
  }

  function fmtMoney(v) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("pt-BR");
  }

  function pickFirstMlb(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const m = raw.match(/MLB\d+/i);
    if (m) return m[0].toUpperCase();
    return raw.split(/\s+/)[0].trim().toUpperCase();
  }

  function setAlert(type, msg) {
    const box = $("alertArea");
    if (!box) return;
    if (!msg) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="alert alert-${type} mb-0">${esc(msg)}</div>`;
  }

  function setModalAlert(type, msg) {
    const box = $("editModalAlert");
    if (!box) return;
    if (!msg) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="alert alert-${type} mb-0">${esc(msg)}</div>`;
  }

  async function copyToClipboard(text) {
    const t = String(text ?? "");
    if (!t) return false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (_) {}

    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function getJSONAny(paths) {
    let lastErr = null;
    for (const p of paths) {
      try {
        const r = await fetch(p, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status} ${txt || ""}`.trim());
        }

        const data = await r.json();
        // se algum backend retorna {success:false}, trata aqui
        if (data && data.success === false && data.error) {
          throw new Error(data.error);
        }
        return { ok: true, data, used: p };
      } catch (e) {
        lastErr = e;
      }
    }
    return {
      ok: false,
      error: lastErr ? lastErr.message : "Falha",
      used: null,
    };
  }

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    mlb: "",
    item: null,
    endpointUsed: "",
    diag: null,
  };

  function setEnabled(on) {
    const ids = [
      "btnDiagnose",
      "btnEdit",
      "btnCopyJson",
      "btnCopyJson2",
      "btnPretty",
      "btnOpenMl",
      "btnOpenApi",
      "btnCopyPermalink",
      "btnRunDiagnose",
      "btnExportDiag",
    ];
    ids.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !on;
    });
  }

  function resetUI() {
    state.mlb = "";
    state.item = null;
    state.endpointUsed = "";
    state.diag = null;

    setAlert(null, "");
    setModalAlert(null, "");
    setEnabled(false);

    $("chipMlb").textContent = "MLB: —";
    $("chipStatus").textContent = "Status: —";
    $("chipAccount").textContent = "Conta: —";

    $("kpiTitle").textContent = "—";
    $("kpiListingType").textContent = "—";
    $("kpiPrice").textContent = "—";
    $("kpiStock").textContent = "—";
    $("kpiCreatedAt").textContent = "—";
    $("kpiCategory").textContent = "—";

    $("infoMlb").textContent = "—";
    $("infoStatus").textContent = "—";
    $("infoSeller").textContent = "—";
    $("infoCategory").textContent = "—";
    $("infoCondition").textContent = "—";

    const perm = $("infoPermalink");
    if (perm) {
      perm.textContent = "—";
      perm.href = "#";
    }

    const thumbImg = $("thumbImg");
    const thumbFallback = $("thumbFallback");
    if (thumbImg) {
      thumbImg.src = "";
      thumbImg.style.display = "none";
    }
    if (thumbFallback) thumbFallback.style.display = "flex";
    $("thumbHint").textContent = "—";

    $("jsonPre").textContent = "{}";
    $("lastUpdateInfo").textContent = "";

    // diagnóstico
    const diagEmpty = $("diagEmpty");
    const diagList = $("diagList");
    if (diagEmpty) diagEmpty.style.display = "block";
    if (diagList) {
      diagList.classList.add("d-none");
      diagList.innerHTML = "";
    }
  }

  // ----------------------------
  // Inner tabs
  // ----------------------------
  function initInnerTabs() {
    const tabs = qsa(".inner-tab");
    const panes = qsa(".pane");

    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));

        t.classList.add("active");
        const targetId = t.dataset.pane;
        const target = $(targetId);
        if (target) target.classList.add("active");
      });
    });
  }

  function openPane(id) {
    const tab = qs(`.inner-tab[data-pane="${id}"]`);
    if (tab) tab.click();
  }

  // ----------------------------
  // Normalize item payload
  // ----------------------------
  function normalizeItemPayload(payload) {
    if (!payload) return null;
    // aceita formatos comuns: {item}, {data}, {ok:true,item:...}, ou direto o item
    if (payload.item) return payload.item;
    if (payload.data && payload.data.id) return payload.data;
    if (payload.ok && payload.id) return payload;
    if (payload.id) return payload;
    return payload;
  }

  function firstPictureUrl(item) {
    if (!item) return "";
    if (item.pictures && item.pictures.length) {
      return item.pictures[0].url || item.pictures[0].secure_url || "";
    }
    if (item.thumbnail) return item.thumbnail;
    if (item.secure_thumbnail) return item.secure_thumbnail;
    return "";
  }

  // ----------------------------
  // Render
  // ----------------------------
  function renderItem(item) {
    const mlb = item?.id || state.mlb;

    $("chipMlb").textContent = `MLB: ${mlb || "—"}`;
    $("chipStatus").textContent = `Status: ${item?.status || "—"}`;

    const accountLabel =
      ($("account-current")?.textContent || "").trim() || "—";
    $("chipAccount").textContent = `Conta: ${accountLabel}`;

    $("kpiTitle").textContent = item?.title || "—";
    $("kpiListingType").textContent = item?.listing_type_id || "—";
    $("kpiPrice").textContent = fmtMoney(item?.price);
    $("kpiStock").textContent =
      item?.available_quantity != null ? String(item.available_quantity) : "—";
    $("kpiCreatedAt").textContent = fmtDate(item?.date_created);
    $("kpiCategory").textContent = item?.category_id || "—";

    $("infoMlb").textContent = mlb || "—";
    $("infoStatus").textContent = item?.status || "—";
    $("infoSeller").textContent =
      item?.seller_id != null ? String(item.seller_id) : "—";
    $("infoCategory").textContent = item?.category_id || "—";
    $("infoCondition").textContent = item?.condition || "—";

    const permalink = item?.permalink || "";
    const a = $("infoPermalink");
    if (a) {
      a.textContent = permalink ? permalink : "—";
      a.href = permalink ? permalink : "#";
    }

    // thumb
    const pic = firstPictureUrl(item);
    const thumbImg = $("thumbImg");
    const thumbFallback = $("thumbFallback");
    if (thumbImg && thumbFallback) {
      if (pic) {
        thumbImg.src = pic;
        thumbImg.style.display = "block";
        thumbFallback.style.display = "none";
        $("thumbHint").textContent = "Imagem do anúncio (primeira foto).";
      } else {
        thumbImg.src = "";
        thumbImg.style.display = "none";
        thumbFallback.style.display = "flex";
        $("thumbHint").textContent = "Nenhuma imagem disponível no payload.";
      }
    }

    // JSON
    $("jsonPre").textContent = JSON.stringify(item, null, 2);

    // last update
    $("lastUpdateInfo").textContent = `Atualizado em ${nowStr()}`;

    setEnabled(true);
  }

  // ----------------------------
  // Load
  // ----------------------------
  async function loadItem() {
    const input = $("mlbInput");
    const mlb = pickFirstMlb(input?.value || "");
    if (!mlb) {
      setAlert("warning", "Informe um MLB válido (ex: MLB123...).");
      return;
    }

    setAlert(null, "");
    showOverlay();

    // tenta alguns endpoints comuns (você ajusta conforme seus routes reais)
    const candidates = [
      `/api/anuncios/${encodeURIComponent(mlb)}`,
      `/api/items/${encodeURIComponent(mlb)}`,
      `/api/ml/items/${encodeURIComponent(mlb)}`,
      `/api/mercadolivre/items/${encodeURIComponent(mlb)}`,
      `/items/${encodeURIComponent(mlb)}`,
    ];

    const res = await getJSONAny(candidates);
    hideOverlay();

    if (!res.ok) {
      resetUI();
      $("mlbInput").value = mlb;
      setAlert(
        "danger",
        `Não consegui carregar o anúncio (${mlb}). Ajuste o endpoint no front ou crie uma rota GET compatível. Detalhe: ${res.error}`
      );
      return;
    }

    const item = normalizeItemPayload(res.data);
    if (!item || !item.id) {
      resetUI();
      $("mlbInput").value = mlb;
      setAlert("danger", `Resposta inesperada do endpoint (${res.used}).`);
      return;
    }

    state.mlb = item.id;
    state.item = item;
    state.endpointUsed = res.used;

    renderItem(item);

    // por padrão, volta pro painel de detalhes
    openPane("pane-detalhes");
  }

  // ----------------------------
  // Diagnose
  // ----------------------------
  function buildClientDiagnostics(item) {
    const out = [];

    const push = (level, title, desc) => out.push({ level, title, desc });

    // status
    if (!item?.status) {
      push("info", "Status ausente", "O payload não trouxe o campo status.");
    } else if (item.status !== "active") {
      push(
        "warning",
        "Anúncio não está ativo",
        `Status atual: ${item.status}. Verifique pausas, finalização ou inconsistências.`
      );
    } else {
      push("success", "Status OK", "Anúncio está ativo.");
    }

    // preço
    const price = Number(item?.price ?? NaN);
    if (!Number.isFinite(price) || price <= 0) {
      push("danger", "Preço inválido", "Preço está ausente ou <= 0.");
    } else {
      push("success", "Preço OK", `Preço atual: ${fmtMoney(price)}.`);
    }

    // estoque
    const qty = Number(item?.available_quantity ?? NaN);
    if (!Number.isFinite(qty)) {
      push(
        "info",
        "Estoque ausente",
        "available_quantity não veio no payload."
      );
    } else if (qty <= 0) {
      push("warning", "Sem estoque", "available_quantity está zerado.");
    } else {
      push("success", "Estoque OK", `available_quantity: ${qty}.`);
    }

    // imagens
    const pic = firstPictureUrl(item);
    if (!pic)
      push("warning", "Sem imagem", "Nenhuma imagem detectada no payload.");

    // listing type
    if (!item?.listing_type_id) {
      push("info", "Tipo ausente", "listing_type_id não veio no payload.");
    }

    // categoria
    if (!item?.category_id) {
      push("info", "Categoria ausente", "category_id não veio no payload.");
    }

    // permalink
    if (!item?.permalink) {
      push("info", "Permalink ausente", "permalink não veio no payload.");
    }

    return out;
  }

  function renderDiagnostics(list) {
    const diagEmpty = $("diagEmpty");
    const diagList = $("diagList");

    if (!diagEmpty || !diagList) return;

    if (!list || list.length === 0) {
      diagEmpty.style.display = "block";
      diagList.classList.add("d-none");
      diagList.innerHTML = "";
      return;
    }

    diagEmpty.style.display = "none";
    diagList.classList.remove("d-none");

    const icon = (lvl) =>
      ({
        success: "bi-check2-circle",
        info: "bi-info-circle",
        warning: "bi-exclamation-triangle",
        danger: "bi-x-octagon",
      }[lvl] || "bi-dot");

    const badge = (lvl) =>
      ({
        success: "text-bg-success",
        info: "text-bg-secondary",
        warning: "text-bg-warning",
        danger: "text-bg-danger",
      }[lvl] || "text-bg-secondary");

    diagList.innerHTML = list
      .map(
        (x) => `
      <div class="diag-item">
        <div class="diag-item__left">
          <span class="badge ${badge(x.level)}"><i class="bi ${icon(
          x.level
        )}"></i></span>
        </div>
        <div class="diag-item__body">
          <div class="diag-item__title">${esc(x.title)}</div>
          <div class="diag-item__desc">${esc(x.desc)}</div>
        </div>
      </div>
    `
      )
      .join("");
  }

  async function runDiagnose() {
    if (!state.item) return;

    setAlert(null, "");
    showOverlay();

    // tenta endpoint de diagnóstico (se existir), senão faz client-side
    const mlb = state.mlb;
    const candidates = [
      `/api/anuncios/${encodeURIComponent(mlb)}/diagnostico`,
      `/api/items/${encodeURIComponent(mlb)}/diagnostico`,
      `/api/ml/items/${encodeURIComponent(mlb)}/diagnostico`,
    ];

    const res = await getJSONAny(candidates);
    hideOverlay();

    let diag = null;
    if (res.ok && res.data) {
      // aceita {checks:[]}, {diagnostico:[]}, ou direto []
      diag =
        res.data.checks ||
        res.data.diagnostico ||
        (Array.isArray(res.data) ? res.data : null);
    }

    if (!diag) {
      diag = buildClientDiagnostics(state.item);
    }

    state.diag = diag;
    renderDiagnostics(diag);

    openPane("pane-diagnostico");
  }

  function exportDiagnostics() {
    const data = {
      mlb: state.mlb,
      generated_at: new Date().toISOString(),
      diagnostics: state.diag || [],
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostico_${state.mlb || "anuncio"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----------------------------
  // Edit modal (placeholder)
  // ----------------------------
  let editModal = null;

  function openEditModal() {
    if (!state.item) return;

    // prefill
    $("editTitle").value = state.item.title || "";
    $("editPrice").value =
      state.item.price != null ? String(state.item.price) : "";
    $("editStock").value =
      state.item.available_quantity != null
        ? String(state.item.available_quantity)
        : "";

    setModalAlert(null, "");
    if (!editModal) {
      const el = $("editModal");
      if (el && window.bootstrap) editModal = new window.bootstrap.Modal(el);
    }
    editModal?.show();
  }

  function saveEditFrontOnly() {
    if (!state.item) return;

    const title = String($("editTitle")?.value ?? "").trim();
    const price = Number($("editPrice")?.value ?? NaN);
    const stock = Number($("editStock")?.value ?? NaN);

    // validações leves
    if (title && title.length < 3) {
      setModalAlert("warning", "Título muito curto.");
      return;
    }
    if (!Number.isNaN(price) && price < 0) {
      setModalAlert("warning", "Preço não pode ser negativo.");
      return;
    }
    if (!Number.isNaN(stock) && stock < 0) {
      setModalAlert("warning", "Estoque não pode ser negativo.");
      return;
    }

    // aplica no estado (front-only)
    if (title) state.item.title = title;
    if (!Number.isNaN(price)) state.item.price = price;
    if (!Number.isNaN(stock)) state.item.available_quantity = stock;

    renderItem(state.item);
    setModalAlert("success", "Atualizado no front. (Sem backend ainda)");
  }

  // ----------------------------
  // Button binds
  // ----------------------------
  function bind() {
    // Enter no input = carregar
    $("mlbInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadItem();
      }
    });

    $("btnLoad")?.addEventListener("click", loadItem);

    // ambos chamam diagnóstico
    $("btnDiagnose")?.addEventListener("click", runDiagnose);
    $("btnRunDiagnose")?.addEventListener("click", runDiagnose);

    $("btnEdit")?.addEventListener("click", openEditModal);
    $("saveEditBtn")?.addEventListener("click", saveEditFrontOnly);

    $("btnClear")?.addEventListener("click", () => {
      $("mlbInput").value = "";
      resetUI();
    });

    // copy JSON (2 botões)
    const doCopyJson = async () => {
      const ok = await copyToClipboard($("jsonPre")?.textContent || "");
      setAlert(
        ok ? "success" : "warning",
        ok ? "JSON copiado!" : "Não consegui copiar o JSON."
      );
      setTimeout(() => setAlert(null, ""), 1800);
    };
    $("btnCopyJson")?.addEventListener("click", doCopyJson);
    $("btnCopyJson2")?.addEventListener("click", doCopyJson);

    // pretty
    $("btnPretty")?.addEventListener("click", () => {
      if (!state.item) return;
      $("jsonPre").textContent = JSON.stringify(state.item, null, 2);
      setAlert("success", "JSON formatado.");
      setTimeout(() => setAlert(null, ""), 1200);
    });

    // Open ML
    $("btnOpenMl")?.addEventListener("click", () => {
      const link = state.item?.permalink;
      if (link) window.open(link, "_blank", "noopener");
    });

    // Open API
    $("btnOpenApi")?.addEventListener("click", () => {
      const link = state.endpointUsed;
      if (link) window.open(link, "_blank", "noopener");
    });

    // Copy permalink
    $("btnCopyPermalink")?.addEventListener("click", async () => {
      const link = state.item?.permalink || "";
      const ok = await copyToClipboard(link);
      setAlert(
        ok ? "success" : "warning",
        ok ? "Link copiado!" : "Não consegui copiar o link."
      );
      setTimeout(() => setAlert(null, ""), 1800);
    });

    // Export diag
    $("btnExportDiag")?.addEventListener("click", exportDiagnostics);
  }

  // ----------------------------
  // Boot
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initInnerTabs();
    bind();
    resetUI();

    // atualiza chip de conta depois que account-bar.js preencher
    setTimeout(() => {
      const accountLabel =
        ($("account-current")?.textContent || "").trim() || "—";
      $("chipAccount").textContent = `Conta: ${accountLabel}`;
    }, 300);
  });
})();
