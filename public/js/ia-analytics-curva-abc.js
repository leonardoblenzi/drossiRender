// public/js/ia-analytics-curva-abc.js
// UI da página Curva ABC (tempo real via API do ML)

(() => {
  console.log("🚀 Curva ABC • ML tempo real");

  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
  const $ = (id) => document.getElementById(id);

  const fmtMoneyCents = (c) =>
    (Number(c || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const fmtPct = (x) =>
    `${(Number(x || 0) * 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;
  const asArray = (sel) =>
    Array.from(sel.selectedOptions)
      .map((o) => o.value)
      .filter(Boolean);

  // =========================================================
  // PROGRESS UI (barra lateral)
  // =========================================================
  function ensureProgressPanel() {
    let panel = $("reportProgressPanel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "reportProgressPanel";
    panel.style.cssText = `
      position: fixed; right: 16px; top: 80px; width: 320px; z-index: 10000;
      background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.12);
      border: 1px solid #eee; display:none; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    `;
    panel.innerHTML = `
      <div style="padding:14px 16px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; justify-content:space-between">
        <strong>Processando relatório</strong>
        <button type="button" id="rpClose" style="border:none;background:#f6f6f6;border-radius:8px;padding:6px 10px;cursor:pointer">Fechar</button>
      </div>
      <div style="padding:16px">
        <div id="rpTitle" style="font-size:13px;color:#666">Iniciando…</div>
        <div style="height:8px;background:#f3f3f3;border-radius:999px;margin:10px 0 6px 0;overflow:hidden">
          <div id="rpBar" style="height:100%;width:0;background:#4f46e5;transition:width .25s ease"></div>
        </div>
        <div id="rpPct" style="font-size:12px;color:#666">0%</div>
        <div id="rpLog" style="margin-top:10px;max-height:180px;overflow:auto;font-size:12px;color:#444"></div>
      </div>
    `;
    document.body.appendChild(panel);
    panel
      .querySelector("#rpClose")
      .addEventListener("click", () => hideProgress());
    return panel;
  }

  function showProgress(title) {
    const p = ensureProgressPanel();
    p.style.display = "block";
    qs("#rpTitle", p).textContent = title || "Processando…";
    qs("#rpBar", p).style.width = "0%";
    qs("#rpPct", p).textContent = "0%";
    qs("#rpLog", p).innerHTML = "";
  }
  function hideProgress() {
    const p = $("reportProgressPanel");
    if (p) p.style.display = "none";
  }
  function logProgress(msg, type = "info") {
    const p = $("reportProgressPanel");
    if (!p) return;
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.margin = "4px 0";
    el.style.color =
      type === "error" ? "#b42318" : type === "warn" ? "#8a6d3b" : "#444";
    qs("#rpLog", p).appendChild(el);
    qs("#rpLog", p).scrollTop = qs("#rpLog", p).scrollHeight;
  }
  function updateProgress(pct) {
    const p = $("reportProgressPanel");
    if (!p) return;
    const clamped = Math.max(0, Math.min(100, pct));
    qs("#rpBar", p).style.width = clamped + "%";
    qs("#rpPct", p).textContent = clamped.toFixed(0) + "%";
  }

  // Helpers
  function keepOnlySold(row) {
    return Number(row?.units || 0) > 0;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        cache: "no-store",
      });
      return r;
    } finally {
      clearTimeout(id);
    }
  }

  function adsBadgeHTML(statusCode, statusText, hasActivity) {
    const cls =
      statusCode === "active"
        ? "ads-yes"
        : statusCode === "paused"
        ? "ads-paused"
        : "ads-no";
    const hint =
      statusCode === "active"
        ? hasActivity
          ? "Em campanha (com atividade no período)"
          : "Em campanha (sem atividade no período)"
        : statusCode === "paused"
        ? "Em campanha (pausado no período)"
        : hasActivity
        ? "Sem campanha (houve atividade registrada — verifique atribuição)"
        : "Sem campanha no período";
    return `<span class="ads-badge ${cls}" title="${hint}"><span class="dot"></span>${statusText}</span>`;
  }

  const state = {
    curveTab: "ALL",
    loading: false,
    groupBy: "mlb",
    metric: "revenue",
    aCut: 0.75,
    bCut: 0.92,
    minUnits: 1,
    limit: 20,
    page: 1,
    sort: null,
    lastItems: [],
    totals: null,
    curveCards: null,
    accountKey: null,

    // Conta atual (cookie OAuth)
    currentAccountLabel: "—",
    currentAccountKey: null,
  };

  // Topbar
  async function initTopBar() {
    try {
      const r = await fetch("/api/account/current", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const j = await r.json().catch(() => null);

      // ✅ guarda a conta atual no state (ajuda no fallback do getFilters)
      state.accountKey = j?.accountKey || j?.current?.id || null;

      const shown = j?.label || j?.accountKey || j?.current?.label || "—";
      const el = $("account-current");
      if (el) el.textContent = shown;
    } catch {
      // silencioso
    }

    const btnSwitch = $("account-switch");
    if (btnSwitch) {
      btnSwitch.addEventListener("click", async () => {
        try {
          await fetch("/api/account/clear", {
            method: "POST",
            credentials: "include",
          });
        } catch {}
        location.href = "/select-conta";
      });
    }

    const btnStatus = $("btn-status");
    if (btnStatus) {
      btnStatus.addEventListener("click", async () => {
        try {
          const r = await fetch("/verificar-token", {
            credentials: "include",
            cache: "no-store",
          });
          const d = await r.json();
          alert(
            d.success
              ? `✅ ${d.message}\nUser: ${d.nickname}\nToken: ${d.token_preview}`
              : `❌ ${d.error || "Falha ao verificar"}`
          );
        } catch (e) {
          alert("❌ " + (e?.message || e));
        }
      });
    }
  }

  function setDefaultDates() {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - 29);
    $("fDateFrom").value = from.toISOString().slice(0, 10);
    $("fDateTo").value = to.toISOString().slice(0, 10);
  }

  /**
   * ✅ NOVO PADRÃO:
   * - a conta ativa é o cookie httpOnly (meli_conta_id)
   * - então esse select vira apenas "informativo" / compat com HTML antigo.
   * - buscamos /api/meli/contas (rota do seu fluxo novo).
   */
  async function loadAccounts() {
    const sel = $("fAccounts");
    if (!sel) return;

    sel.innerHTML = "";

    // ✅ Novo padrão: pega conta selecionada no backend (cookie httpOnly)
    const r = await fetch("/api/account/current", {
      credentials: "include",
      cache: "no-store",
    });

    // Se não conseguiu, força voltar pra seleção
    if (!r.ok) {
      location.href = "/select-conta";
      return;
    }

    const j = await r.json().catch(() => null);

    const key = j?.accountKey || j?.current?.id || null;
    const label = j?.label || j?.current?.label || null;

    if (!key) {
      // sem conta selecionada -> volta pra tela certa
      location.href = "/select-conta";
      return;
    }

    // Cria 1 opção (modo OAuth é 1 conta por sessão)
    const op = document.createElement("option");
    op.value = String(key);
    op.textContent = String(label || `Conta ${key}`);
    op.selected = true;
    sel.appendChild(op);
  }

  /**
   * ✅ IMPORTANTE:
   * no padrão OAuth, NÃO enviamos `accounts` no querystring.
   * o backend deve usar a conta do cookie (meli_conta_id) via ensureAccount.
   */
  function getFilters(extra = {}) {
    // garante accounts sempre preenchido (select OU fallback do state.accountKey)
    const sel = $("fAccounts");
    const selected = sel ? asArray(sel).join(",") : "";
    const accountsVal =
      selected || (state?.accountKey ? String(state.accountKey) : "");

    const base = {
      date_from: $("fDateFrom").value,
      date_to: $("fDateTo").value,

      // ✅ sempre manda accounts, senão seu backend tende a retornar 400
      accounts: accountsVal,

      full: $("fFull").value || "all",
      metric: state.metric,
      group_by: state.groupBy,
      a_cut: state.aCut,
      b_cut: state.bCut,
      min_units: 1,
      limit: state.limit,
      page: state.page,
    };

    if (state.sort) base.sort = state.sort;

    return Object.assign(base, extra);
  }

  function setLoading(on) {
    state.loading = on;
    let overlay = qs("#abcLoading");
    if (on) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "abcLoading";
        overlay.style.cssText = `
          position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
          background:rgba(0,0,0,.08);backdrop-filter:saturate(80%) blur(0px);z-index:9999;
          font:500 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        `;
        overlay.innerHTML = `<div class="card" style="padding:18px 20px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.08)">
          Carregando Curva ABC…</div>`;
        document.body.appendChild(overlay);
      }
    } else {
      overlay?.remove();
    }
  }

  function renderMiniCards() {
    const cc = state.curveCards || {};
    const T = state.totals || {};

    const fill = (pref, data) => {
      if (!data) return;
      const units = Number(data.units || data.units_total || 0);
      const revCts = Number(
        data.revenue_cents || data.revenue_cents_total || 0
      );
      const items = Number(data.items_count ?? data.count_items ?? 0);
      const ticket = Number(
        data.ticket_avg_cents ?? (units > 0 ? Math.round(revCts / units) : 0)
      );
      const rShare = Number(data.revenue_share ?? data.share ?? 0);

      $(`k${pref}_units`).textContent = units.toLocaleString("pt-BR");
      $(`k${pref}_value`).textContent = fmtMoneyCents(revCts);
      $(`k${pref}_items`).textContent = items.toLocaleString("pt-BR");
      $(`k${pref}_ticket`).textContent = fmtMoneyCents(ticket);
      $(`k${pref}_share`).textContent = fmtPct(rShare);
    };

    fill("A", cc.A);
    fill("B", cc.B);
    fill("C", cc.C);

    const tUnits = Number(T.units_total || 0);
    const tRev = Number(T.revenue_cents_total || 0);
    $("kT_units").textContent = tUnits.toLocaleString("pt-BR");
    $("kT_value").textContent = fmtMoneyCents(tRev);
    $("kT_items").textContent = Number(T.items_total || 0).toLocaleString(
      "pt-BR"
    );
    $("kT_ticket").textContent = fmtMoneyCents(
      tUnits > 0 ? Math.round(tRev / tUnits) : 0
    );
  }

  function renderCardsMeta(curves) {
    const safe = (obj) => obj || { share: 0, count_items: 0 };
    const A = safe(curves?.A),
      B = safe(curves?.B),
      C = safe(curves?.C);
    $("cardAmeta").textContent = `${(A.share * 100).toFixed(1)}% • ${
      A.count_items
    } itens`;
    $("cardBmeta").textContent = `${(B.share * 100).toFixed(1)}% • ${
      B.count_items
    } itens`;
    $("cardCmeta").textContent = `${(C.share * 100).toFixed(1)}% • ${
      C.count_items
    } itens`;
  }

  function fillUL(id, arr) {
    const ul = $(id);
    ul.innerHTML = "";
    (arr || []).forEach((i) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="muted">${i.mlb || ""}${i.sku ? " • " + i.sku : ""}</span>
        <span><b>${i.units || 0}</b> • ${fmtMoneyCents(
        i.revenue_cents || 0
      )}</span>
      `;
      ul.appendChild(li);
    });
  }

  async function loadSummary() {
    setLoading(true);
    try {
      const params = new URLSearchParams(getFilters()).toString();
      const r = await fetch(`/api/analytics/abc-ml/summary?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`summary HTTP ${r.status}`);
      const j = await r.json();

      state.totals = j.totals || null;
      state.curveCards = j.curve_cards || null;

      renderMiniCards();
      renderCardsMeta(j.curves);
      fillUL("listA", j.top5?.A);
      fillUL("listB", j.top5?.B);
      fillUL("listC", j.top5?.C);
    } catch (e) {
      console.error(e);
      alert("❌ Falha ao carregar resumo da Curva ABC.");
    } finally {
      setLoading(false);
    }
  }

  function setSelection(tag) {
    qsa(".cards .card").forEach((c) => c.classList.remove("selected"));
    if (tag === "TOTAL") {
      const t = $("cardTotal");
      t && t.classList.add("selected");
    } else if (tag === "A" || tag === "B" || tag === "C") {
      const el = qs(`.cards .card[data-curve="${tag}"]`);
      el && el.classList.add("selected");
    }
  }

  function renderTable(rows, page, total, limit) {
    state.lastItems = Array.isArray(rows) ? rows : [];
    state.page = page;

    const tb = qs("#grid tbody");
    tb.innerHTML = "";

    const T = state.totals || {};
    const uTotal = Number(T.units_total || 0);
    const rTotal = Number(T.revenue_cents_total || 0);

    state.lastItems.forEach((r, idx) => {
      try {
        const curve = r.curve || "-";
        const pillClass = curve ? `idx-${curve}` : "";

        const unitShare =
          typeof r.unit_share === "number"
            ? r.unit_share
            : uTotal > 0
            ? (r.units || 0) / uTotal
            : 0;
        const revShare =
          typeof r.revenue_share === "number"
            ? r.revenue_share
            : rTotal > 0
            ? (r.revenue_cents || 0) / rTotal
            : 0;

        const promoActive = !!(r.promo && r.promo.active);
        const promoPct =
          r.promo && r.promo.percent != null ? Number(r.promo.percent) : null;
        const promoTxt = promoActive ? "Sim" : "Não";
        const promoPctTxt =
          promoActive && promoPct != null ? fmtPct(promoPct) : "—";

        const ads = r.ads || {};
        const statusCode =
          ads.status_code || (ads.in_campaign ? "active" : "none");
        const statusText =
          ads.status_text || (ads.in_campaign ? "Ativo" : "Não");
        const clicks = Number(ads.clicks || 0);
        const imps = Number(ads.impressions || 0);
        const spendC = Number(ads.spend_cents || 0);
        const aRevC = Number(ads.revenue_cents || 0);
        const hasActivity =
          !!ads.had_activity || clicks + imps + spendC + aRevC > 0;
        const acosVal = aRevC > 0 ? spendC / aRevC : null;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="idx-pill ${pillClass}">${curve}</span></td>
          <td>${r.mlb || ""}</td>
          <td>${r.title || ""}</td>
          <td>${(r.units || 0).toLocaleString("pt-BR")}</td>
          <td class="percent">${fmtPct(unitShare)}</td>
          <td class="num">${fmtMoneyCents(r.revenue_cents || 0)}</td>
          <td class="percent">${fmtPct(revShare)}</td>
          <td>${promoTxt}</td>
          <td class="percent">${promoPctTxt}</td>
          <td>${adsBadgeHTML(statusCode, statusText, hasActivity)}</td>
          <td class="num">${clicks.toLocaleString("pt-BR")}</td>
          <td class="num">${imps.toLocaleString("pt-BR")}</td>
          <td class="num">${fmtMoneyCents(spendC)}</td>
          <td class="percent">${
            hasActivity && acosVal !== null ? fmtPct(acosVal) : "—"
          }</td>
          <td class="num">${fmtMoneyCents(aRevC)}</td>
        `;
        tb.appendChild(tr);
      } catch (rowErr) {
        console.error("Falha ao renderizar linha", idx, rowErr, r);
      }
    });

    renderPagination(page, total, limit);
  }

  async function loadItems(curve = state.curveTab || "ALL", page = 1) {
    setLoading(true);
    try {
      state.curveTab = curve;
      state.page = page;

      if (curve === "ALL" && state.sort === "share") {
        setSelection("TOTAL");
      } else if (curve === "ALL") {
        qsa(".cards .card").forEach((c) => c.classList.remove("selected"));
      } else {
        setSelection(curve);
      }

      const base = getFilters({
        curve,
        page,
        limit: state.limit,
        include_ads: "1",
        include_visits: "1",
      });

      const s = $("fSearch").value?.trim();
      if (s) base.search = s;

      const params = new URLSearchParams(base).toString();
      const url = `/api/analytics/abc-ml/items?${params}`;

      const resp = await fetchWithTimeout(
        url,
        { credentials: "same-origin" },
        90000
      );
      if (!resp.ok) throw new Error(`items HTTP ${resp.status}`);
      const j = await resp.json();

      if (!j || !Array.isArray(j.data)) {
        console.warn("Resposta inesperada de /items", j);
        renderTable(
          [],
          j?.page || page,
          j?.total || 0,
          j?.limit || state.limit
        );
        return;
      }

      let rows = j.data.slice();

      rows = rows.filter(keepOnlySold);
      if (state.sort === "share") {
        const T = state.totals || {};
        const rTotal = Number(T.revenue_cents_total || 0);
        rows = rows
          .map((it) => {
            const share =
              typeof it.revenue_share === "number"
                ? it.revenue_share
                : rTotal > 0
                ? (it.revenue_cents || 0) / rTotal
                : 0;
            return { ...it, __share__: share };
          })
          .sort((a, b) => b.__share__ - a.__share__);
      } else if (state.metric === "revenue") {
        rows.sort((a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0));
      } else {
        rows.sort((a, b) => (b.units || 0) - (a.units || 0));
      }

      renderTable(
        rows,
        j.page || page,
        j.total ?? rows.length,
        j.limit || state.limit
      );
    } catch (e) {
      console.error(e);
      alert("❌ Falha ao carregar itens da Curva ABC: " + (e?.message || e));
      renderTable([], page, 0, state.limit);
    } finally {
      setLoading(false);
    }
  }

  function renderPagination(page, total, limit) {
    const pager = $("pager");
    const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 20)));

    const mkBtn = (p, label = null, disabled = false, active = false) => {
      const b = document.createElement("button");
      b.className =
        "pg-btn" + (active ? " active" : "") + (disabled ? " disabled" : "");
      b.textContent = label || String(p);
      b.disabled = !!disabled;
      if (!disabled && !active) b.addEventListener("click", () => goToPage(p));
      return b;
    };

    pager.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "paginator";

    wrap.appendChild(mkBtn(Math.max(1, page - 1), "«", page <= 1));
    for (let p = 1; p <= totalPages; p++) {
      wrap.appendChild(mkBtn(p, String(p), false, p === page));
    }
    wrap.appendChild(
      mkBtn(Math.min(totalPages, page + 1), "»", page >= totalPages)
    );

    pager.appendChild(wrap);
  }

  function goToPage(p) {
    const curve = state.curveTab || "ALL";
    loadItems(curve, p);
  }

  // CSV / progressFab (mantido como estava, só garantindo no-store em fetch)
  function debounce(fn, ms = 300) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  function applySwitchDefaults() {
    qsa("#switch-groupby .btn-switch").forEach((b) =>
      b.classList.toggle("active", b.dataset.group === state.groupBy)
    );
    qsa("#switch-metric  .btn-switch").forEach((b) =>
      b.classList.toggle("active", b.dataset.metric === state.metric)
    );
  }

  function renderAccountChips() {
    const sel = $("fAccounts");
    const box = $("accChips");
    if (!sel || !box) return;
    const opts = Array.from(sel.selectedOptions);
    if (!opts.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = opts
      .map((o) => `<span class="chip">${o.textContent}</span>`)
      .join("");
  }

  function bind() {
    $("btnPesquisar").addEventListener("click", () => {
      state.page = 1;
      loadSummary();
      loadItems("ALL", 1);
    });

    qsa(".cards .card[data-curve]").forEach((el) => {
      el.addEventListener("click", () => {
        const curve = el.getAttribute("data-curve") || "ALL";
        state.sort = null;
        state.page = 1;
        loadItems(curve, 1);
      });
    });

    const totalCard = $("cardTotal");
    if (totalCard) {
      totalCard.addEventListener("click", () => {
        $("fSearch").value = "";
        state.sort = "share";
        state.page = 1;
        loadItems("ALL", 1);
      });
    }

    qsa("#switch-groupby .btn-switch").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa("#switch-groupby .btn-switch").forEach((b) =>
          b.classList.remove("active")
        );
        btn.classList.add("active");
        state.groupBy = btn.dataset.group;
        state.page = 1;
        loadSummary();
        loadItems(state.curveTab || "ALL", 1);
      });
    });

    qsa("#switch-metric .btn-switch").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa("#switch-metric .btn-switch").forEach((b) =>
          b.classList.remove("active")
        );
        btn.classList.add("active");
        state.metric = btn.dataset.metric;
        state.page = 1;
        loadSummary();
        loadItems(state.curveTab || "ALL", 1);
      });
    });

    $("fSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.page = 1;
        loadItems("ALL", 1);
      }
    });
    $("fSearch").addEventListener(
      "input",
      debounce(() => {
        state.page = 1;
        loadItems(state.curveTab || "ALL", 1);
      }, 500)
    );

    $("fFull").addEventListener("change", () => {
      state.page = 1;
      loadSummary();
      loadItems(state.curveTab || "ALL", 1);
    });

    // ⚠️ no padrão novo, esse select é informativo; não recarrega por ele
    $("fAccounts")?.addEventListener("change", renderAccountChips);
  }

  window.addEventListener("DOMContentLoaded", async () => {
    await initTopBar();
    setDefaultDates();
    await loadAccounts();
    renderAccountChips();
    applySwitchDefaults();
    bind();
    await loadSummary();
    await loadItems("ALL", 1);
  });
})();
