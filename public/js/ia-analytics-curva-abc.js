// public/js/ia-analytics-curva-abc.js
// UI da página Curva ABC (tempo real via API do ML) — NOVO PADRÃO (cookie meli_conta_id)
// ✅ não manda accounts no querystring
// ✅ export CSV funcionando (btnExportCsv)
// ✅ inclui fetchAllPages + progressFab (não depende de libs externas)

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

  // =========================================================
  // Helpers
  // =========================================================
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
  };

  // =========================================================
  // Progress FAB (para exportação)
  // =========================================================
  const progressFab = (() => {
    let el = null;

    function ensure() {
      if (el) return el;

      el = document.createElement("div");
      el.id = "progressFab";
      el.style.cssText = `
        position: fixed; right: 18px; bottom: 18px; z-index: 10001;
        width: 360px; max-width: calc(100vw - 36px);
        background: #fff; border: 1px solid #eee; border-radius: 14px;
        box-shadow: 0 14px 40px rgba(0,0,0,.14);
        overflow: hidden; display: none;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      `;

      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #f1f1f1">
          <div style="font-weight:700">Exportação</div>
          <button type="button" id="pfClose" style="border:none;background:#f6f6f6;border-radius:10px;padding:6px 10px;cursor:pointer">Fechar</button>
        </div>
        <div style="padding:12px 14px">
          <div id="pfMsg" style="font-size:13px;color:#555">Preparando…</div>
          <div style="height:10px;background:#f3f3f3;border-radius:999px;margin:10px 0 6px 0;overflow:hidden">
            <div id="pfBar" style="height:100%;width:0;background:#16a34a;transition:width .2s ease"></div>
          </div>
          <div id="pfPct" style="font-size:12px;color:#666">0%</div>
          <div id="pfMeta" style="margin-top:8px;font-size:12px;color:#666"></div>
        </div>
      `;
      document.body.appendChild(el);

      el.querySelector("#pfClose").addEventListener("click", () => {
        el.style.display = "none";
      });

      return el;
    }

    function show(msg = "Preparando…") {
      const p = ensure();
      p.style.display = "block";
      p.querySelector("#pfMsg").textContent = msg;
      p.querySelector("#pfBar").style.width = "0%";
      p.querySelector("#pfPct").textContent = "0%";
      p.querySelector("#pfMeta").textContent = "";
    }

    function message(msg) {
      const p = ensure();
      p.querySelector("#pfMsg").textContent = msg;
    }

    function progress(cur, total, opts = {}) {
      const p = ensure();
      const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
      p.querySelector("#pfBar").style.width = `${Math.max(
        0,
        Math.min(100, pct)
      )}%`;
      p.querySelector("#pfPct").textContent = `${Math.max(
        0,
        Math.min(100, pct)
      )}%`;
      const metaBits = [];
      if (opts.withAds) metaBits.push("Ads: ON");
      if (opts.withVisits) metaBits.push("Visits: ON");
      if (opts.limit) metaBits.push(`limit=${opts.limit}`);
      p.querySelector("#pfMeta").textContent = metaBits.join(" • ");
    }

    function done(ok) {
      const p = ensure();
      p.querySelector("#pfBar").style.width = "100%";
      p.querySelector("#pfPct").textContent = "100%";
      p.querySelector("#pfMsg").textContent = ok ? "Concluído ✅" : "Falhou ❌";
    }

    return { show, message, progress, done };
  })();

  // =========================================================
  // Topbar / Account
  // =========================================================
  async function initTopBar() {
    try {
      const r = await fetch("/api/account/current", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const j = await r.json().catch(() => null);
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
    const f1 = $("fDateFrom");
    const f2 = $("fDateTo");
    if (f1) f1.value = from.toISOString().slice(0, 10);
    if (f2) f2.value = to.toISOString().slice(0, 10);
  }

  /**
   * ✅ Novo padrão:
   * - conta ativa é cookie httpOnly (meli_conta_id)
   * - este select vira apenas informativo (compat)
   */
  async function loadAccounts() {
    const sel = $("fAccounts");
    if (!sel) return;

    sel.innerHTML = "";

    const r = await fetch("/api/account/current", {
      credentials: "include",
      cache: "no-store",
    });

    if (!r.ok) {
      location.href = "/select-conta";
      return;
    }

    const j = await r.json().catch(() => null);
    const key = j?.accountKey || j?.current?.id || null;
    const label = j?.label || j?.current?.label || null;

    if (!key) {
      location.href = "/select-conta";
      return;
    }

    const op = document.createElement("option");
    op.value = String(key);
    op.textContent = String(label || `Conta ${key}`);
    op.selected = true;
    sel.appendChild(op);
  }

  // =========================================================
  // Filters (✅ sem accounts)
  // =========================================================
  function getFilters(extra = {}) {
    const base = {
      date_from: $("fDateFrom")?.value,
      date_to: $("fDateTo")?.value,
      full: $("fFull")?.value || "all",
      metric: state.metric,
      group_by: state.groupBy,
      a_cut: state.aCut,
      b_cut: state.bCut,
      min_units: state.minUnits,
      limit: state.limit,
      page: state.page,
    };

    if (state.sort) base.sort = state.sort;
    return Object.assign(base, extra);
  }

  // =========================================================
  // Loading overlay
  // =========================================================
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

  // =========================================================
  // Cards / UI
  // =========================================================
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
    const aEl = $("cardAmeta");
    const bEl = $("cardBmeta");
    const cEl = $("cardCmeta");
    if (aEl)
      aEl.textContent = `${(A.share * 100).toFixed(1)}% • ${
        A.count_items
      } itens`;
    if (bEl)
      bEl.textContent = `${(B.share * 100).toFixed(1)}% • ${
        B.count_items
      } itens`;
    if (cEl)
      cEl.textContent = `${(C.share * 100).toFixed(1)}% • ${
        C.count_items
      } itens`;
  }

  function fillUL(id, arr) {
    const ul = $(id);
    if (!ul) return;
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

  // =========================================================
  // API calls
  // =========================================================
  async function loadSummary() {
    setLoading(true);
    try {
      const params = new URLSearchParams(getFilters()).toString();
      const r = await fetch(`/api/analytics/abc-ml/summary?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(
          `summary HTTP ${r.status} ${t ? "• " + t.slice(0, 180) : ""}`
        );
      }
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
      alert("❌ Falha ao carregar resumo da Curva ABC.\n" + (e?.message || e));
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
    if (!tb) return;
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

        const visits = Number(r.visits || r.visits_total || 0);
        const conv = visits > 0 ? Number(r.units || 0) / visits : null;

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
          <td class="num">${visits.toLocaleString("pt-BR")}</td>
          <td class="percent">${conv != null ? fmtPct(conv) : "—"}</td>
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

      const s = $("fSearch")?.value?.trim();
      if (s) base.search = s;

      const params = new URLSearchParams(base).toString();
      const url = `/api/analytics/abc-ml/items?${params}`;

      const resp = await fetchWithTimeout(
        url,
        { credentials: "same-origin" },
        90000
      );
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(
          `items HTTP ${resp.status} ${t ? "• " + t.slice(0, 180) : ""}`
        );
      }
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
      alert("❌ Falha ao carregar itens da Curva ABC:\n" + (e?.message || e));
      renderTable([], page, 0, state.limit);
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // Pagination
  // =========================================================
  function renderPagination(page, total, limit) {
    const pager = $("pager");
    if (!pager) return;

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

    // evita renderizar 200 botões em telas grandes:
    // janela com ellipsis: 1 … (p-2..p+2) … last
    const windowSize = 2;
    const addPage = (p) =>
      wrap.appendChild(mkBtn(p, String(p), false, p === page));
    const addDots = () => {
      const sp = document.createElement("span");
      sp.textContent = "…";
      sp.style.cssText = "padding:0 8px;color:#777;align-self:center";
      wrap.appendChild(sp);
    };

    if (totalPages <= 9) {
      for (let p = 1; p <= totalPages; p++) addPage(p);
    } else {
      addPage(1);
      if (page > 1 + windowSize + 1) addDots();

      const start = Math.max(2, page - windowSize);
      const end = Math.min(totalPages - 1, page + windowSize);
      for (let p = start; p <= end; p++) addPage(p);

      if (page < totalPages - (windowSize + 1)) addDots();
      addPage(totalPages);
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

  // =========================================================
  // UI bindings
  // =========================================================
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
    const btnPesquisar = $("btnPesquisar");
    if (btnPesquisar) {
      btnPesquisar.addEventListener("click", () => {
        state.page = 1;
        loadSummary();
        loadItems("ALL", 1);
      });
    }

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
        const fSearch = $("fSearch");
        if (fSearch) fSearch.value = "";
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
        state.groupBy = btn.dataset.group || "mlb";
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
        state.metric = btn.dataset.metric || "revenue";
        state.page = 1;
        loadSummary();
        loadItems(state.curveTab || "ALL", 1);
      });
    });

    const fSearch = $("fSearch");
    if (fSearch) {
      fSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          state.page = 1;
          loadItems("ALL", 1);
        }
      });
      fSearch.addEventListener(
        "input",
        debounce(() => {
          state.page = 1;
          loadItems(state.curveTab || "ALL", 1);
        }, 500)
      );
    }

    const fFull = $("fFull");
    if (fFull) {
      fFull.addEventListener("change", () => {
        state.page = 1;
        loadSummary();
        loadItems(state.curveTab || "ALL", 1);
      });
    }

    // informativo apenas
    const fAccounts = $("fAccounts");
    if (fAccounts) fAccounts.addEventListener("change", renderAccountChips);
  }

  // =========================================================
  // CSV Export (btnExportCsv)
  // =========================================================
  async function fetchAllPages(onProgress, opts = {}) {
    const limit = Math.max(20, Math.min(Number(opts.limit || 120), 200));
    const timeoutMs = Number(opts.timeoutMs || 120000);
    const withAds = opts.withAds !== false;
    const withVisits = opts.withVisits !== false;

    // mantém export sempre em ALL (não exporta só A/B/C por padrão)
    const base = getFilters({
      curve: "ALL",
      page: 1,
      limit,
      include_ads: withAds ? "1" : "0",
      include_visits: withVisits ? "1" : "0",
    });

    const s = $("fSearch")?.value?.trim();
    if (s) base.search = s;

    // 1) busca primeira página para descobrir total
    const p1Url = `/api/analytics/abc-ml/items?${new URLSearchParams(
      base
    ).toString()}`;
    const r1 = await fetchWithTimeout(
      p1Url,
      { credentials: "same-origin" },
      timeoutMs
    );
    if (!r1.ok) {
      const t = await r1.text().catch(() => "");
      throw new Error(
        `Export: items HTTP ${r1.status} ${t ? "• " + t.slice(0, 180) : ""}`
      );
    }
    const j1 = await r1.json();

    const total = Number(j1?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    let all = Array.isArray(j1?.data) ? j1.data.slice() : [];
    if (typeof onProgress === "function")
      onProgress(1, totalPages, { withAds, withVisits, limit });

    // 2) páginas restantes
    for (let p = 2; p <= totalPages; p++) {
      const url = `/api/analytics/abc-ml/items?${new URLSearchParams({
        ...base,
        page: p,
      }).toString()}`;

      const r = await fetchWithTimeout(
        url,
        { credentials: "same-origin" },
        timeoutMs
      );
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(
          `Export: page ${p} HTTP ${r.status} ${
            t ? "• " + t.slice(0, 180) : ""
          }`
        );
      }
      const j = await r.json();
      const arr = Array.isArray(j?.data) ? j.data : [];
      all.push(...arr);

      if (typeof onProgress === "function")
        onProgress(p, totalPages, { withAds, withVisits, limit });
    }

    return all;
  }

  async function exportCSV() {
    try {
      setLoading(true);
      progressFab.show("Carregando dados para exportação…");
      showProgress("Exportando CSV…");
      logProgress("Iniciando exportação…");
      hideProgress();
      const allRows = await fetchAllPages(
        (page, totalPages, opts) => {
          progressFab.progress(page, totalPages, opts);
          progressFab.message(`Carregando dados… Página ${page}/${totalPages}`);
        },
        { limit: 120, withAds: true, withVisits: true, timeoutMs: 120000 }
      );

      progressFab.message("Gerando CSV…");
      logProgress("Gerando arquivo CSV…");

      let rowsForCsv = allRows.slice();

      // ordenação consistente
      if (state.sort === "share" || state.metric === "revenue") {
        rowsForCsv.sort(
          (a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0)
        );
      } else {
        rowsForCsv.sort((a, b) => (b.units || 0) - (a.units || 0));
      }

      const rowsFiltered = rowsForCsv.filter((r) => Number(r.units || 0) > 0);

      const uTotal = rowsFiltered.reduce((s, r) => s + (r.units || 0), 0);
      const rTotal = rowsFiltered.reduce(
        (s, r) => s + (r.revenue_cents || 0),
        0
      );

      const head = [
        "Índice",
        "MLB",
        "Título",
        "Unidades",
        "Unid. (%)",
        "Valor",
        "FATURAMENTO %",
        "PROMO",
        "% APLICADA",
        "ADS",
        "Cliq.",
        "Impr.",
        "Visit.",
        "Conv.",
        "Invest.",
        "ACOS",
        "Receita Ads",
        "Vendas 7D",
        "Vendas 15D",
        "Vendas 30D",
        "Vendas 40D",
        "Vendas 60D",
        "Vendas 90D",
      ];

      const csvRows = rowsFiltered.map((r) => {
        const unitShare = uTotal > 0 ? (r.units || 0) / uTotal : 0;
        const revShare = rTotal > 0 ? (r.revenue_cents || 0) / rTotal : 0;

        const promoActive = !!(r.promo && r.promo.active);
        const promoTxt = promoActive ? "Sim" : "Não";
        const promoPct =
          r.promo && r.promo.percent != null ? Number(r.promo.percent) : null;
        const promoPctCsv =
          promoActive && promoPct != null
            ? (promoPct * 100).toFixed(2).replace(".", ",") + "%"
            : "—";

        const ads = r.ads || {};
        const clicks = Number(ads.clicks || 0);
        const imps = Number(ads.impressions || 0);
        const spendC = Number(ads.spend_cents || 0);
        const aRevC = Number(ads.revenue_cents || 0);
        const acosVal = aRevC > 0 ? spendC / aRevC : null;
        const statusText =
          ads.status_text || (ads.in_campaign ? "Ativo" : "Não");

        const visits = Number(r.visits || r.visits_total || 0);
        const conv = visits > 0 ? Number(r.units || 0) / visits : null;

        return [
          r.curve || "-",
          r.mlb || "",
          (r.title || "").replace(/"/g, '""'),

          r.units || 0,
          (unitShare * 100).toFixed(2).replace(".", ",") + "%",
          (Number(r.revenue_cents || 0) / 100).toFixed(2).replace(".", ","),
          (revShare * 100).toFixed(2).replace(".", ",") + "%",

          promoTxt,
          promoPctCsv,

          statusText,
          clicks,
          imps,
          visits,
          conv != null ? (conv * 100).toFixed(2).replace(".", ",") + "%" : "—",

          (spendC / 100).toFixed(2).replace(".", ","),
          acosVal !== null
            ? (acosVal * 100).toFixed(2).replace(".", ",") + "%"
            : "—",
          (aRevC / 100).toFixed(2).replace(".", ","),

          Number(r.units_7d || 0),
          Number(r.units_15d || 0),
          Number(r.units_30d || 0),
          Number(r.units_40d || 0),
          Number(r.units_60d || 0),
          Number(r.units_90d || 0),
        ];
      });

      // monta CSV com ; e aspas
      const data = [head, ...csvRows]
        .map((cols) => cols.map((c) => `"${String(c)}"`).join(";"))
        .join("\r\n");

      const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "curva_abc.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      progressFab.message("Concluído!");
      progressFab.done(true);
    } catch (e) {
      console.error(e);
      progressFab.message("Falha: " + (e?.message || e));
      progressFab.done(false);
      logProgress("Falha: " + (e?.message || e), "error");
      alert("❌ Falha ao exportar CSV: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function bindExportCsvButton() {
    const btn = $("btnExportCsv");
    if (!btn) {
      console.warn("⚠️ btnExportCsv não encontrado no DOM.");
      return;
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      exportCSV();
    });
  }

  // =========================================================
  // Boot
  // =========================================================
  window.addEventListener("DOMContentLoaded", async () => {
    await initTopBar();
    setDefaultDates();
    await loadAccounts();
    renderAccountChips();
    applySwitchDefaults();
    bind();
    bindExportCsvButton();
    await loadSummary();
    await loadItems("ALL", 1);
  });
})();
