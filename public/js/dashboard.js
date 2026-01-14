// public/js/dashboard.js
console.log("✅ Dashboard.js carregado (single-source)");

// =========================
// Util
// =========================
const $ = (id) => document.getElementById(id);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

function safeBind(el, ev, fn) {
  if (el) el.addEventListener(ev, fn);
}
function show(el) {
  if (el) el.style.display = "block";
}
function hide(el) {
  if (el) el.style.display = "none";
}
function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

const fmtBRL = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(n);
  } catch {
    return "R$ " + n.toFixed(2);
  }
};

const fmtNum = (v) => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("pt-BR").format(n);
  } catch {
    return String(n);
  }
};

function showDashAlert(type, text) {
  const el = $("dash-alert");
  if (!el) return;
  el.className = "";
  el.style.display = "block";
  el.classList.add(
    "dash-alert",
    type === "error" ? "dash-alert--error" : "dash-alert--info"
  );
  el.textContent = text;
}
function hideDashAlert() {
  const el = $("dash-alert");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
  el.className = "";
}

// =========================
// Abas (hash)
// =========================
function initTabs() {
  const tabs = qsa(".nav-tab");
  const pages = qsa(".tab-page");

  tabs.forEach((btn) => {
    safeBind(btn, "click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      pages.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const id = "tab-" + btn.dataset.tab;
      const page = $(id);
      if (page) page.classList.add("active");

      if (btn.dataset.tab)
        history.replaceState(null, "", "#" + btn.dataset.tab);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function openTabByHash() {
  const hash = (location.hash || "").replace("#", "").trim();
  if (!hash) return;
  const btn = document.querySelector(`.nav-tab[data-tab="${hash}"]`);
  if (btn) btn.click();
}

// =========================
// Conta atual / Trocar conta
// =========================
async function carregarContaAtual() {
  const currentEl = $("account-current");
  const inlineEl = $("account-name-inline");

  const setBoth = (txt) => {
    if (currentEl) currentEl.textContent = txt;
    if (inlineEl) inlineEl.textContent = txt;
  };

  try {
    const r = await fetch("/api/account/current", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    const ct = String(r.headers.get("content-type") || "");
    if (!ct.includes("application/json")) return setBoth("Indisponível");

    const data = await r.json().catch(() => null);

    if ((data?.ok || data?.success) && data?.accountKey) {
      const shown = String(data?.label || "").trim() || "Conta selecionada";
      return setBoth(shown);
    }

    setBoth("Não selecionada");
  } catch {
    setBoth("Indisponível");
  }
}

async function trocarConta() {
  // usa o endpoint que você já tem no projeto (oauth)
  try {
    await fetch("/api/meli/limpar-selecao", {
      method: "POST",
      credentials: "include",
    });
  } catch {}
  window.location.href = "/select-conta";
}

// =========================
// Modal Status (token)
// =========================
function abrirModalStatus() {
  show($("modal-status"));
}
function fecharModalStatus() {
  hide($("modal-status"));
}

async function verificarToken(updateModal = false) {
  try {
    const response = await fetch("/verificar-token", {
      credentials: "include",
    });
    const data = await response.json().catch(() => null);

    if (data?.success) {
      if (updateModal) {
        setText("status-usuario", data.nickname || "—");
        setText("status-token", data.token_preview || "—");
        setText("status-msg", data.message || "OK");
      } else {
        alert(
          `✅ ${data.message || "OK"}\nUser: ${data.nickname || "—"}\nToken: ${
            data.token_preview || "—"
          }`
        );
      }
    } else {
      const msg = data?.error || "Falha ao verificar";
      if (updateModal) setText("status-msg", msg);
      else alert("❌ " + msg);
    }
  } catch (error) {
    if (updateModal) setText("status-msg", "Erro: " + error.message);
    else alert("❌ Erro: " + error.message);
  }
}

async function renovarToken(updateModal = false) {
  try {
    const response = await fetch("/renovar-token-automatico", {
      method: "POST",
      credentials: "include",
    });

    const data = await response.json().catch(() => null);

    if (data?.success) {
      if (updateModal) {
        setText("status-usuario", data.nickname || "—");
        setText(
          "status-token",
          (data.access_token || "").substring(0, 20) + "..."
        );
        setText("status-msg", data.message || "Token renovado");
      } else {
        alert(
          `✅ ${data.message || "Token renovado"}\nUser: ${
            data.nickname || "—"
          }\nNovo token: ${(data.access_token || "").substring(0, 20)}...`
        );
      }
    } else {
      const msg = data?.error || "Falha ao renovar";
      if (updateModal) setText("status-msg", msg);
      else alert("❌ " + msg);
    }
  } catch (error) {
    if (updateModal) setText("status-msg", "Erro: " + error.message);
    else alert("❌ Erro: " + error.message);
  }
}

// =========================
// Dashboard (KPIs)
// =========================
function setPill(id, text, kind /* ok | warn | neutral */) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;

  // Se teu CSS não tiver classes específicas, isso é só no-op visual.
  el.classList.remove("pill-ok", "pill-warn", "pill-neutral");
  if (kind === "ok") el.classList.add("pill-ok");
  else if (kind === "warn") el.classList.add("pill-warn");
  else el.classList.add("pill-neutral");
}

function renderNoSparkline() {
  const wrap = $("dash-sparkline");
  const empty = $("dash-spark-empty");
  if (wrap) wrap.innerHTML = "";
  if (empty) empty.style.display = "block";
}

// ==================================================
// ✅ Sparkline (Ritmo do mês) — GARANTE que existe no dashboard.js
// ==================================================
function renderSparkline(dailyOrders, dayOfMonth, daysInMonth) {
  const wrap = document.getElementById("dash-sparkline");
  const empty = document.getElementById("dash-spark-empty");
  if (!wrap) return;

  wrap.innerHTML = "";

  const arr = Array.isArray(dailyOrders) ? dailyOrders : [];
  if (!arr.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  // ✅ pega máximo de revenue pra escala visual
  const max = Math.max(1, ...arr.map((x) => Number(x?.revenue || 0)));

  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] || {};
    const value = Number(d.revenue || 0);

    // mínimo visual pra não sumir
    const pct = Math.max(0.04, value / max);

    const bar = document.createElement("div");
    bar.className = "spark-bar";

    const dayIndex = i + 1;
    if (dayIndex > dayOfMonth) bar.classList.add("is-future");
    if (dayIndex === dayOfMonth) bar.classList.add("is-today");

    bar.style.height = Math.round(pct * 100) + "%";

    // ✅ tooltips
    const fmtBRL =
      window.fmtBRL ||
      ((v) =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(Number(v || 0)));

    const fmtNum =
      window.fmtNum ||
      ((v) => new Intl.NumberFormat("pt-BR").format(Number(v || 0)));

    bar.title = `${d.date || ""}\nVendas: ${fmtBRL(value)}\nPedidos: ${fmtNum(
      d.orders || 0
    )}\nUnidades: ${fmtNum(d.units || 0)}`;

    wrap.appendChild(bar);
  }

  // ✅ barra de progresso do mês
  const fill = document.getElementById("dash-progress-fill");
  const meta = document.getElementById("dash-progress-meta");

  const progress = Math.min(
    100,
    Math.max(0, (Number(dayOfMonth || 1) / Number(daysInMonth || 30)) * 100)
  );

  if (fill) fill.style.width = progress.toFixed(2) + "%";
  if (meta)
    meta.textContent = `Dia ${dayOfMonth} de ${daysInMonth} (${progress.toFixed(
      0
    )}% do mês)`;
}

// ✅ se algum outro trecho chamar via window, garante
window.renderSparkline = renderSparkline;

async function carregarDashboard() {
  hideDashAlert();

  try {
    // ✅ agora usa /summary (e /monthly-sales também funciona)
    const r = await fetch("/api/dashboard/summary?tz=America%2FSao_Paulo", {
      cache: "no-store",
    });
    const txt = await r.text().catch(() => "");
    const data = txt ? JSON.parse(txt) : null;

    if (!r.ok || !data || !data.ok) {
      throw new Error(data && data.error ? data.error : `HTTP ${r.status}`);
    }

    const period = data.period || {};
    const totals = data.totals || {};
    const series = data.series || {};
    const breakdown = data.breakdown || {};

    const month = String(period.month || "").padStart(2, "0");
    const y = String(period.year || "");
    const monthKey = period.month_key || (y && month ? `${y}-${month}` : "—");

    setText("dash-period", monthKey);
    setText(
      "dash-day",
      `${period.day_of_month || "—"}/${period.days_in_month || "—"}`
    );

    const totalAll = Number(
      breakdown.total_all || totals.revenue_month_to_date || 0
    );

    setText("dash-total", fmtBRL(totalAll));
    setText("dash-projected", fmtBRL(totals.revenue_projected_month || 0));
    setText("dash-avg", fmtBRL(totals.avg_daily_revenue || 0));

    setText("dash-orders", fmtNum(totals.orders_count || 0));
    setText("dash-units", fmtNum(totals.units_sold || 0));
    setText("dash-ticket", fmtBRL(totals.ticket_medio || 0));

    const hint = `Ex: (${fmtBRL(totals.revenue_month_to_date || 0)} ÷ ${
      period.day_of_month || 1
    }) × ${period.days_in_month || 30}`;
    setText("dash-formula-hint", hint);

    renderSparkline(
      series.daily_orders || [],
      period.day_of_month || 1,
      period.days_in_month || 30
    );

    // ==================================================
    // ✅ ADS (atribuído) — reaproveita seu endpoint da Publicidade
    // ==================================================
    try {
      const firstDay = `${monthKey}-01`;
      const today =
        period.today ||
        `${monthKey}-${String(period.day_of_month || 1).padStart(2, "0")}`;

      const urlAds = `/api/publicidade/product-ads/metrics/daily?date_from=${encodeURIComponent(
        firstDay
      )}&date_to=${encodeURIComponent(today)}`;
      const ra = await fetch(urlAds, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const ta = await ra.text().catch(() => "");
      const da = ta ? JSON.parse(ta) : {};

      if (!ra.ok) throw new Error(`HTTP ${ra.status}`);

      const arr = Array.isArray(da.results || da.series)
        ? da.results || da.series
        : [];
      let adsAmount = 0;

      for (const row of arr) {
        // prioriza direct_amount; se não existir, usa total_amount
        adsAmount += Number(row.direct_amount ?? row.total_amount ?? 0);
      }

      setText("dash-ads", fmtBRL(adsAmount));
      setText("dash-ads-pill", "ok");

      const organic = Math.max(0, totalAll - adsAmount);
      setText("dash-organic", fmtBRL(organic));
    } catch (adsErr) {
      // se Ads falhar, não derruba o dashboard
      setText("dash-ads", fmtBRL(0));
      setText("dash-ads-pill", "indisp.");
      setText("dash-organic", fmtBRL(totalAll));
      showDashAlert("info", `ℹ️ Ads indisponível: ${adsErr.message || adsErr}`);
    }
  } catch (e) {
    console.error("carregarDashboard:", e);
    showDashAlert(
      "error",
      "❌ Não foi possível carregar o dashboard: " + (e.message || String(e))
    );
  }
}

// =========================
// Boot
// =========================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    initTabs();
    openTabByHash();
    if (!location.hash) history.replaceState(null, "", "#dashboard");

    // conta
    carregarContaAtual();
    safeBind($("account-switch"), "click", trocarConta);

    // status
    safeBind($("btn-status"), "click", async () => {
      abrirModalStatus();
      await verificarToken(true);
    });

    // refresh
    safeBind($("dash-refresh"), "click", carregarDashboard);

    // fechar modal clicando fora
    window.addEventListener("click", (event) => {
      const m = $("modal-status");
      if (event.target === m) fecharModalStatus();
    });

    // carregamento inicial
    await carregarDashboard();
  } catch (err) {
    console.error("Erro na inicialização do dashboard:", err);
  }
});

// expor pro onclick do HTML
window.abrirModalStatus = abrirModalStatus;
window.fecharModalStatus = fecharModalStatus;
window.verificarToken = verificarToken;
window.renovarToken = renovarToken;
window.trocarConta = trocarConta;
