/* public/js/select-conta.js
 * Novo padrão (OAuth + Banco):
 * - Lista contas via GET /api/meli/contas
 * - Seleciona conta via POST /api/meli/selecionar -> seta cookie httpOnly meli_conta_id
 * - Limpa seleção via POST /api/meli/limpar-selecao
 *
 * MASTER MODE (admin_master):
 * - Busca (empresa/apelido/meli_user_id), filtro "Somente ativas", badges (tokens/expiração) e paginação
 * - Troca botão "Vincular Conta" por "Painel Admin"
 *
 * ⚠️ Alinhado com seu backend atual (meliOAuthRoutes.js):
 * - query params: q, onlyActive=1, page, pageSize
 * - response: { ok, contas, current_meli_conta_id, page, pageSize, total, totalPages, is_master }
 */

(() => {
  const $ = (sel) => document.querySelector(sel);

  const elList = $("#list");
  const elAlert = $("#alert");
  const elCurrent = $("#account-current");

  const btnVincular = $("#btn-vincular");
  const btnAdmin = $("#btn-admin");
  const btnSair = $("#btn-sair");
  const btnDashboard = $("#btn-dashboard");
  const btnLimpar = $("#btn-limpar");

  // ===========================
  // Estado
  // ===========================
  const state = {
    me: null,
    isMaster: false,

    contas: [],
    currentId: null,

    // master query
    q: "",
    onlyActive: false,
    page: 1,
    pageSize: 24,

    // server pagination
    total: 0,
    totalPages: 1,

    // refs UI master (criados via JS)
    masterControlsMounted: false,
    elSearch: null,
    elOnlyActive: null,
    elResultsInfo: null,
    elPageInfo: null,
    btnPrev: null,
    btnNext: null,
  };

  // ===========================
  // Helpers UI
  // ===========================
  function showAlert(text, type = "warn") {
    if (!elAlert) return;
    elAlert.style.display = "block";
    elAlert.textContent = text;

    elAlert.style.marginTop = "12px";
    elAlert.style.padding = "10px 12px";
    elAlert.style.borderRadius = "10px";
    elAlert.style.border = "1px solid rgba(255,255,255,.15)";
    elAlert.style.background =
      type === "err"
        ? "rgba(255,90,90,.12)"
        : type === "ok"
        ? "rgba(46,204,113,.12)"
        : "rgba(255,230,0,.12)";
    elAlert.style.color =
      type === "err" ? "#ff5a5a" : type === "ok" ? "#2ecc71" : "#ffe600";
  }

  function clearAlert() {
    if (!elAlert) return;
    elAlert.style.display = "none";
    elAlert.textContent = "";
  }

  function fmtDate(isoOrTs) {
    if (!isoOrTs) return "—";
    try {
      const d = parseDateSmart(isoOrTs);
      if (!d) return "—";
      return d.toLocaleString("pt-BR");
    } catch {
      return "—";
    }
  }

  function statusLabel(status) {
    const s = String(status || "").toLowerCase();
    if (s === "ativa" || s === "active" || s === "enabled") return "🟢 ativa";
    if (s === "revogada" || s === "revoked") return "🟠 revogada";
    if (s === "erro" || s === "error") return "🔴 erro";
    return status || "—";
  }

  function sanitize(str) {
    return String(str ?? "").replace(/[<>&'"]/g, (c) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function debounce(fn, ms = 220) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ===========================
  // Parse de data robusto (corrige "expirado" falso)
  // - aceita ISO com timezone, timestamp, e formato postgres "YYYY-MM-DD HH:mm:ss"
  // ===========================
  function parseDateSmart(v) {
    if (!v) return null;

    // number timestamp
    if (typeof v === "number" && Number.isFinite(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const s = String(v).trim();
    if (!s) return null;

    // timestamp num em string
    if (/^\d{11,15}$/.test(s)) {
      const n = Number(s);
      const d = new Date(n);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // ISO ok
    if (s.includes("T")) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // Postgres comum: "YYYY-MM-DD HH:mm:ss" (sem timezone)
    // Interpreta como horário local do browser (consistente) e converte corretamente.
    // Se seu backend mandar esse formato, isso evita "Invalid Date"/timezone bug.
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]) - 1;
      const day = Number(m[3]);
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      const ss = Number(m[6] || "0");
      const d = new Date(year, month, day, hh, mm, ss);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // fallback
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ===========================
  // Fetch JSON (robusto)
  // ===========================
  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...opts,
    });

    const ct = String(r.headers.get("content-type") || "");
    if (!ct.includes("application/json")) {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      throw new Error("Resposta inesperada (não JSON). Você está logado?");
    }

    const data = await r.json().catch(() => null);
    return { r, data };
  }

  // ===========================
  // MASTER detection
  // ===========================
  function computeIsMaster(meData) {
    // Seu /api/auth/me retorna { ok, logged, user, flags:{is_master,...} }
    if (meData?.flags?.is_master === true) return true;
    const nivel = meData?.user?.nivel;
    return String(nivel || "").trim().toLowerCase() === "admin_master";
  }

  async function loadMe() {
    try {
      const { r, data } = await fetchJson("/api/auth/me");
      if (!r.ok || !data) {
        window.location.href = "/login";
        return null;
      }

      if (data.logged !== true) {
        window.location.href = "/login";
        return null;
      }

      state.me = data;
      state.isMaster = computeIsMaster(data);
      return data;
    } catch {
      state.me = null;
      state.isMaster = false;
      window.location.href = "/login";
      return null;
    }
  }

  function applyMasterTopbar() {
    // Troca Vincular -> Painel Admin (somente master)
    if (state.isMaster) {
      if (btnVincular) btnVincular.style.display = "none";
      if (btnAdmin) btnAdmin.style.display = "";
    } else {
      if (btnVincular) btnVincular.style.display = "";
      if (btnAdmin) btnAdmin.style.display = "none";
    }
  }

  // ===========================
  // MASTER Controls (injetados via JS)
  // ===========================
  function mountMasterControlsIfNeeded() {
    if (!state.isMaster) return;
    if (state.masterControlsMounted) return;

    const wrap = document.querySelector(".select-wrap");
    if (!wrap || !elList) return;

    const controls = document.createElement("div");
    controls.id = "master-controls";
    controls.style.margin = "14px 0 10px";
    controls.style.padding = "12px";
    controls.style.borderRadius = "14px";
    controls.style.border = "1px solid rgba(255,255,255,.12)";
    controls.style.background = "rgba(255,255,255,.04)";

    controls.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; flex:1;">
          <input
            id="master-search"
            type="text"
            placeholder="Buscar por empresa, apelido ou meli_user_id…"
            style="
              flex:1; min-width:240px;
              padding:10px 12px;
              border-radius:12px;
              border:1px solid rgba(255,255,255,.16);
              background: rgba(0,0,0,.15);
              color: inherit;
              outline:none;
            "
          />
          <label style="display:flex; gap:8px; align-items:center; white-space:nowrap; opacity:.95;">
            <input id="master-only-active" type="checkbox" />
            Somente contas ativas
          </label>
        </div>

        <div id="master-results-info" style="opacity:.9; font-size:.92rem; white-space:nowrap;">
          —
        </div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
        <div style="opacity:.85; font-size:.92rem;" id="master-page-info">—</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" id="master-prev" class="btn btn-ghost">◀ Anterior</button>
          <button type="button" id="master-next" class="btn btn-ghost">Próxima ▶</button>
        </div>
      </div>
    `;

    wrap.insertBefore(controls, elList);

    state.elSearch = $("#master-search");
    state.elOnlyActive = $("#master-only-active");
    state.elResultsInfo = $("#master-results-info");
    state.elPageInfo = $("#master-page-info");
    state.btnPrev = $("#master-prev");
    state.btnNext = $("#master-next");

    const onChange = debounce(async () => {
      state.q = String(state.elSearch?.value || "").trim();
      state.onlyActive = !!state.elOnlyActive?.checked;
      state.page = 1;
      await loadContasOAuth();
    }, 220);

    state.elSearch?.addEventListener("input", onChange);
    state.elOnlyActive?.addEventListener("change", onChange);

    state.btnPrev?.addEventListener("click", async () => {
      if (state.page > 1) {
        state.page -= 1;
        await loadContasOAuth();
      }
    });

    state.btnNext?.addEventListener("click", async () => {
      if (state.page < state.totalPages) {
        state.page += 1;
        await loadContasOAuth();
      }
    });

    state.masterControlsMounted = true;
  }

  // ===========================
  // Badges (tokens / expiração)
  // ===========================
  function badgeStyle(kind) {
    const base =
      "display:inline-block; padding:6px 10px; border-radius:999px; font-size:.82rem; border:1px solid rgba(255,255,255,.12);";
    if (kind === "ok")
      return (
        base +
        "background: rgba(46,204,113,.12); color:#2ecc71; border-color: rgba(46,204,113,.25);"
      );
    if (kind === "warn")
      return (
        base +
        "background: rgba(255,230,0,.12); color:#ffe600; border-color: rgba(255,230,0,.25);"
      );
    if (kind === "err")
      return (
        base +
        "background: rgba(255,90,90,.12); color:#ff5a5a; border-color: rgba(255,90,90,.25);"
      );
    return (
      base +
      "background: rgba(255,255,255,.06); color: rgba(255,255,255,.85);"
    );
  }

  function calcExpiryMinutes(accessExpiresAt) {
    if (!accessExpiresAt) return null;
    const d = parseDateSmart(accessExpiresAt);
    if (!d) return null;
    return Math.floor((d.getTime() - Date.now()) / 60000);
  }

  function renderBadges(c) {
    const hasTokens = c?.has_tokens === true;

    const tokensBadge = hasTokens
      ? `<span style="${badgeStyle("ok")}">✅ Tokens OK</span>`
      : `<span style="${badgeStyle("warn")}">⛔ Sem tokens</span>`;

    const mins = calcExpiryMinutes(c?.access_expires_at);

    // Melhor UX: quando não tem tokens, não mostra "Expirado"
    if (!hasTokens) {
      return `
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          ${tokensBadge}
          <span style="${badgeStyle("muted")}">⏳ Expira: —</span>
        </div>
      `;
    }

    let expBadge = `<span style="${badgeStyle("muted")}">⏳ Expira: —</span>`;
    if (mins !== null) {
      if (mins < 0) expBadge = `<span style="${badgeStyle("err")}">⏳ Expirado</span>`;
      else if (mins <= 10) expBadge = `<span style="${badgeStyle("warn")}">⚠️ Expira em ${mins} min</span>`;
      else expBadge = `<span style="${badgeStyle("muted")}">⏳ Expira em ${mins} min</span>`;
    }

    return `
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        ${tokensBadge}
        ${expBadge}
      </div>
    `;
  }

  // ===========================
  // Render
  // ===========================
  function renderEmpty(msg) {
    elList.innerHTML = `
      <div class="hint" style="opacity:.9; padding:14px;">
        ${sanitize(msg || "Nenhuma conta encontrada.")}
      </div>
    `;
  }

  function renderCards(contas, currentId = null) {
    if (!Array.isArray(contas) || contas.length === 0) {
      if (state.isMaster) {
        renderEmpty("Nenhuma conta encontrada com os filtros atuais.");
      } else {
        renderEmpty(
          "Nenhuma conta do Mercado Livre vinculada ainda.\nClique em Vincular Conta para conectar a primeira."
        );
      }
      if (elCurrent) elCurrent.textContent = "Não selecionada";
      return;
    }

    if (elCurrent) {
      if (currentId) {
        const cur = contas.find((c) => Number(c.id) === Number(currentId));
        if (cur) elCurrent.textContent = cur.apelido || `Conta ${cur.meli_user_id}`;
        else elCurrent.textContent = "Não selecionada";
      } else {
        elCurrent.textContent = "Selecione uma conta";
      }
    }

    elList.innerHTML = contas
      .map((c) => {
        const isCurrent = currentId && Number(c.id) === Number(currentId);

        const title = sanitize(c.apelido || `Conta ${c.meli_user_id}`);

        const empresa = sanitize(c.empresa_nome || "");
        const empresaLine = state.isMaster && empresa ? `Empresa: ${empresa}<br>` : "";

        const sub = [
          `${empresaLine}ML User ID: ${sanitize(c.meli_user_id)}`,
          `Site: ${sanitize(c.site_id || "MLB")}`,
          `Status: ${sanitize(statusLabel(c.status))}`,
          `Criado: ${sanitize(fmtDate(c.criado_em))}`,
        ].join("<br>");

        const badges = state.isMaster ? renderBadges(c) : "";

        return `
          <button
            class="acc-btn"
            data-id="${sanitize(c.id)}"
            style="${isCurrent ? "outline:2px solid rgba(255,230,0,.7);" : ""}"
          >
            ${title}
            <span class="sub">${sub}</span>

            ${badges}

            <span style="display:block; margin-top:10px; font-size:.9rem; opacity:.9;">
              ${isCurrent ? "✅ Selecionada nesta sessão" : "👉 Clique para usar esta conta"}
            </span>
          </button>
        `;
      })
      .join("");

    [...elList.querySelectorAll(".acc-btn")].forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.getAttribute("data-id"));
        if (!Number.isFinite(id)) return;
        clearAlert();
        await selecionarContaOAuth(id);
      });
    });
  }

  function updateMasterInfo() {
    if (!state.isMaster) return;

    if (state.elResultsInfo) {
      state.elResultsInfo.textContent = `${state.total} resultado(s)`;
    }

    if (state.elPageInfo) {
      if (!state.total) {
        state.elPageInfo.textContent = "—";
      } else {
        state.elPageInfo.textContent = `Página ${state.page} de ${state.totalPages} • ${state.pageSize} por página`;
      }
    }

    if (state.btnPrev) state.btnPrev.disabled = state.page <= 1;
    if (state.btnNext) state.btnNext.disabled = state.page >= state.totalPages;
  }

  function render() {
    renderCards(state.contas, state.currentId);
    updateMasterInfo();
  }

  // ===========================
  // Backend: loadContas OAuth
  // ===========================
  function buildContasUrl() {
    const url = new URL(window.location.origin + "/api/meli/contas");

    if (state.isMaster) {
      if (state.q) url.searchParams.set("q", state.q);

      // backend atual lê req.query.onlyActive === "1"
      if (state.onlyActive) url.searchParams.set("onlyActive", "1");

      url.searchParams.set("page", String(state.page));
      url.searchParams.set("pageSize", String(state.pageSize));
    }

    return url.pathname + url.search;
  }

  async function loadContasOAuth() {
    try {
      clearAlert();
      elList.innerHTML = `<div class="hint" style="padding:14px;">Carregando contas...</div>`;

      if (state.isMaster) mountMasterControlsIfNeeded();

      const { r, data } = await fetchJson(buildContasUrl());
      if (!r.ok || !data || data.ok !== true) {
        const msg = data?.error || `Falha ao carregar contas (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      state.contas = Array.isArray(data.contas) ? data.contas : [];
      state.currentId = data.current_meli_conta_id || null;

      if (state.isMaster) {
        state.total = Number(data.total || 0);
        state.totalPages = Number(data.totalPages || 1) || 1;

        if (Number.isFinite(Number(data.page))) state.page = Number(data.page);
        if (Number.isFinite(Number(data.pageSize))) state.pageSize = Number(data.pageSize);
      } else {
        state.total = state.contas.length;
        state.totalPages = 1;
        state.page = 1;
      }

      render();
    } catch (e) {
      console.error(e);
      showAlert(`Erro ao carregar contas: ${e.message}`, "err");
      elList.innerHTML = `<div class="hint" style="padding:14px;">Falha ao carregar contas.</div>`;
    }
  }

  async function selecionarContaOAuth(meli_conta_id) {
    try {
      const { r, data } = await fetchJson("/api/meli/selecionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meli_conta_id }),
      });

      if (!r.ok || !data || data.ok !== true) {
        const msg = data?.error || `Falha ao selecionar (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      // ✅ Confere rapidamente se a seleção ficou válida (ajuda MUITO no caso master)
      try {
        const chk = await fetchJson("/api/meli/current");
        if (chk?.r?.ok && chk?.data?.ok === true && chk?.data?.selected !== true) {
          throw new Error("Conta não ficou selecionada (current.selected=false).");
        }
      } catch (e) {
        // se falhar, não redireciona cego
        showAlert(`Conta selecionada, mas falhou ao validar sessão: ${e.message}`, "warn");
        // ainda assim tenta seguir, porque alguns setups bloqueiam /api/meli/current sem conta
      }

      // ✅ segue para o app
      window.location.href = "/dashboard";
    } catch (e) {
      console.error(e);
      showAlert(`Falha ao selecionar conta: ${e.message}`, "err");
    }
  }

  async function limparSelecaoOAuth() {
    try {
      const { r, data } = await fetchJson("/api/meli/limpar-selecao", {
        method: "POST",
      });

      if (!r.ok || !data || data.ok !== true) {
        const msg = data?.error || `Falha ao limpar (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      showAlert("Seleção limpa. Escolha outra conta.", "ok");
      await loadContasOAuth();
    } catch (e) {
      console.warn("limparSelecaoOAuth:", e.message);
      showAlert("Não foi possível limpar automaticamente.", "warn");
    }
  }

  // ===========================
  // Binds
  // ===========================
  btnVincular?.addEventListener("click", () => {
    window.location.href = "/vincular-conta";
  });

  btnAdmin?.addEventListener("click", () => {
    window.location.href = "/admin/usuarios";
  });

  btnSair?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    window.location.href = "/login";
  });

  btnDashboard?.addEventListener("click", () => {
    window.location.href = "/dashboard";
  });

  btnLimpar?.addEventListener("click", async () => {
    await limparSelecaoOAuth();
  });

  // Start
  document.addEventListener("DOMContentLoaded", async () => {
    await loadMe();
    applyMasterTopbar();

    if (state.isMaster) mountMasterControlsIfNeeded();

    await loadContasOAuth();
  });
})();
