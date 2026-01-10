// /public/js/analise-ia.js
// IA • Análise de Anúncio — JS atualizado (pills + indicadores + sem campos repetidos)
// ✅ compatível com seu HTML atual (não quebra se IDs novos não existirem)

(() => {
  const $ = (id) => document.getElementById(id);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  const el = {
    mlbInput: $("mlbInput"),
    days: $("daysSelect"),
    zip: $("zipInput"),

    photoWrap: $("aaPhotoWrap"),
    photoPh: $("aaPhotoPlaceholder"),

    btnLoad: $("btnLoad"),
    btnDiag: $("btnDiag"),
    btnCopy: $("btnCopyJson"),
    btnCopy2: $("btnCopyJson2"),
    btnClear: $("btnClear"),

    chipMlb: $("chipMlb"),
    chipStatus: $("chipStatus"),
    chipConta: $("chipConta"),

    err: $("aaError"),
    ok: $("aaOk"),

    // Resumo (mini-cards) — mantém IDs
    sumTitle: $("sumTitle"),
    sumType: $("sumType"),
    sumPrice: $("sumPrice"),
    sumStock: $("sumStock"),
    sumSold: $("sumSold"),
    sumCreated: $("sumCreated"),

    // antigos (mantém compat)
    sumPremium: $("sumPremium"),
    sumCatalog: $("sumCatalog"),
    sumVisits: $("sumVisits"),
    sumShipping: $("sumShipping"),
    sumSeller: $("sumSeller"),
    sumRep: $("sumRep"),

    // ✅ NOVOS (opcionais no HTML)
    pillPremium: $("pillPremium"),
    pillCatalog: $("pillCatalog"),
    pillOfficial: $("pillOfficial"),
    pillFreeShip: $("pillFreeShip"),

    kpiVisits: $("kpiVisits"),
    kpiConversion: $("kpiConversion"),
    kpiSalesPerDay: $("kpiSalesPerDay"),
    kpiSalesPerMonth: $("kpiSalesPerMonth"),
    kpiSaleEvery: $("kpiSaleEvery"),
    kpiFreteVal: $("kpiFreteVal"),

    // opcional (barra “Faturando” se você criar)
    faturandoVal: $("faturandoVal"),

    lastUpdate: $("lastUpdateInfo"),
    thumb: $("itemThumb"),

    // Painel unificado
    infoList: $("infoList"),

    jsonPre: $("jsonPre"),
    diagBox: $("diagBox"),
  };

  const API_BASE = "/api/analise-anuncios";
  let lastPayload = null;

  // --------------------------
  // Utils
  // --------------------------
  function show(elm) {
    if (elm) elm.classList.remove("d-none");
  }
  function hide(elm) {
    if (elm) elm.classList.add("d-none");
  }
  function setText(elm, v) {
    if (!elm) return;
    elm.textContent = v == null || v === "" ? "—" : String(v);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseFirstMlb(text) {
    const s = String(text || "").toUpperCase();
    const m = s.match(/MLB\d{6,}/);
    return m ? m[0] : "";
  }

  function fmtMoneyBRL(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function fmtInt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("pt-BR");
  }

  function fmtPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    // backend pode mandar 0.0043 (0.43%) ou 0.43 (0.43%)
    const pct = n > 1 ? n : n * 100;
    return `${pct.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("pt-BR");
  }

  function safeStr(v) {
    return v == null || v === "" ? "—" : String(v);
  }

  function setAlert(kind, msg) {
    if (kind === "error") {
      setText(el.err, msg);
      show(el.err);
      hide(el.ok);
    } else if (kind === "ok") {
      setText(el.ok, msg);
      show(el.ok);
      hide(el.err);
    } else {
      hide(el.err);
      hide(el.ok);
    }
  }

  function setChips({ mlb, status }) {
    setText(el.chipMlb, `MLB: ${mlb || "—"}`);
    setText(el.chipStatus, `Status: ${status || "—"}`);
    // chipConta vem do account-bar.js
  }

  // --------------------------
  // Pills helpers
  // --------------------------
  function setPill(elm, { on, labelOn, labelOff, unknownLabel = "—" } = {}) {
    if (!elm) return;
    if (on === true) {
      elm.textContent = labelOn || "Sim";
      elm.classList.add("is-on");
      elm.classList.remove("is-off");
      return;
    }
    if (on === false) {
      elm.textContent = labelOff || "Não";
      elm.classList.add("is-off");
      elm.classList.remove("is-on");
      return;
    }
    elm.textContent = unknownLabel;
    elm.classList.remove("is-on");
    elm.classList.remove("is-off");
  }

  // --------------------------
  // Derivados (sem depender do backend)
  // --------------------------
  function computeDerived(data, days) {
    const s = data?.summary || {};
    const visitsN = Number(data?.visits?.total ?? data?.visits ?? NaN);
    const soldN = Number(s.sold_quantity ?? s.sold ?? NaN);

    const out = {
      visits: Number.isFinite(visitsN) ? visitsN : null,
      sold: Number.isFinite(soldN) ? soldN : null,
      conversion: null,
      saleEvery: null,
      salesPerDay: null,
      salesPerMonth: null,
    };

    // conversão
    const convBackend = data?.metrics?.conversion ?? data?.conversion ?? null;
    if (convBackend != null) out.conversion = Number(convBackend);
    else if (out.visits != null && out.sold != null) {
      out.conversion = out.visits > 0 ? out.sold / out.visits : null;
    }

    if (out.visits != null && out.sold != null && out.sold > 0) {
      out.saleEvery = out.visits / out.sold;
    }

    const d = Number(days);
    if (Number.isFinite(d) && d > 0 && out.sold != null) {
      out.salesPerDay = out.sold / d;
      out.salesPerMonth = out.salesPerDay * 30;
    }

    // prioridade do backend
    const m = data?.metrics || {};
    if (m.sale_every_visits != null) out.saleEvery = Number(m.sale_every_visits);
    if (m.sales_per_day != null) out.salesPerDay = Number(m.sales_per_day);
    if (m.sales_per_month != null) out.salesPerMonth = Number(m.sales_per_month);

    return out;
  }

  // --------------------------
  // Render resumo (mini-cards + pills + indicadores + imagem)
  // --------------------------
  function renderSummary(data) {
    const s = data?.summary || {};

    setText(el.sumTitle, s.title);
    setText(el.sumType, s.listing_type_id || s.listing_type || "—");
    setText(el.sumPrice, fmtMoneyBRL(s.price));
    setText(el.sumStock, s.available_quantity ?? "—");
    setText(el.sumSold, s.sold_quantity ?? s.sold ?? "—");
    setText(el.sumCreated, s.date_created ? fmtDateTime(s.date_created) : "—");

    // Pills (opcionais)
    setPill(el.pillPremium, {
      on: s.is_premium,
      labelOn: "Premium",
      labelOff: "Clássico",
      unknownLabel: "Tipo —",
    });
    setPill(el.pillCatalog, {
      on: s.catalog_listing,
      labelOn: "Item catálogo",
      labelOff: "Sem catálogo",
      unknownLabel: "Catálogo —",
    });

    // Loja oficial (se vier)
    const seller = data?.seller || {};
    const official =
      seller?.official_store != null
        ? !!seller.official_store
        : seller?.official_store_id != null
        ? true
        : null;

    setPill(el.pillOfficial, {
      on: official,
      labelOn: "Loja oficial",
      labelOff: "Loja comum",
      unknownLabel: "Loja —",
    });

    // Frete pill + valor
    const freeShip =
      data?.shipping?.free_shipping != null ? !!data.shipping.free_shipping : null;

    setPill(el.pillFreeShip, {
      on: freeShip,
      labelOn: "Frete grátis",
      labelOff: "Frete pago",
      unknownLabel: "Frete —",
    });

    if (el.kpiFreteVal) {
      const cost = data?.shipping?.cost;
      setText(el.kpiFreteVal, cost != null ? fmtMoneyBRL(cost) : "—");
    }

    // Indicadores
    const days = Number(el.days?.value || 30);
    const derived = computeDerived(data, days);

    if (el.kpiVisits) setText(el.kpiVisits, derived.visits != null ? fmtInt(derived.visits) : "—");
    if (el.kpiConversion) setText(el.kpiConversion, derived.conversion != null ? fmtPct(derived.conversion) : "—");

    if (el.kpiSalesPerDay) {
      setText(
        el.kpiSalesPerDay,
        derived.salesPerDay != null && Number.isFinite(derived.salesPerDay)
          ? derived.salesPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
          : "—"
      );
    }

    if (el.kpiSalesPerMonth) {
      setText(
        el.kpiSalesPerMonth,
        derived.salesPerMonth != null && Number.isFinite(derived.salesPerMonth)
          ? derived.salesPerMonth.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
          : "—"
      );
    }

    if (el.kpiSaleEvery) {
      setText(
        el.kpiSaleEvery,
        derived.saleEvery != null && Number.isFinite(derived.saleEvery)
          ? `1 a cada ${derived.saleEvery.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} visitas`
          : "—"
      );
    }

    // Barra “Faturando” (se existir no HTML) — tenta usar backend, senão calcula price*sold
    if (el.faturandoVal) {
      const fatBackend = data?.metrics?.revenue ?? data?.revenue ?? null;
      const calc = Number(s.price) * Number(s.sold_quantity ?? 0);
      const fat = fatBackend != null ? Number(fatBackend) : Number.isFinite(calc) ? calc : null;
      setText(el.faturandoVal, fat != null && Number.isFinite(fat) ? fmtMoneyBRL(fat) : "—");
    }

    // Compat com resumo antigo (se ainda existir)
    setText(el.sumPremium, s.is_premium ? "Sim" : s.is_premium === false ? "Não" : "—");
    setText(el.sumCatalog, s.catalog_listing ? "Sim" : s.catalog_listing === false ? "Não" : "—");

    const visitsLegacy = data?.visits?.total ?? data?.visits ?? null;
    setText(el.sumVisits, visitsLegacy == null ? "—" : visitsLegacy);

    const shipTxt =
      data?.shipping?.free_shipping != null
        ? `${data.shipping.free_shipping ? "Frete grátis" : "Frete pago"}${
            data.shipping.cost != null ? ` • ${fmtMoneyBRL(data.shipping.cost)}` : ""
          }`
        : "—";
    setText(el.sumShipping, shipTxt);

    const sellerTxt = seller.nickname
      ? `${seller.nickname}${seller.seller_id ? ` • ID ${seller.seller_id}` : ""}${
          seller.location ? ` • ${seller.location}` : ""
        }`
      : "—";
    setText(el.sumSeller, sellerTxt);

    const rep = data?.seller_reputation || {};
    const repTxt = rep.level_id
      ? `${rep.level_id}${rep.power_seller_status ? ` • ${rep.power_seller_status}` : ""}${
          rep.transactions ? ` • vendas ${rep.transactions.completed ?? "—"}` : ""
        }`
      : "—";
    setText(el.sumRep, repTxt);

    // ✅ Imagem: capa grande primeiro
    const thumb =
      s.pictures?.[0] ||
      s.thumbnail ||
      s.picture ||
      data?.pictures?.[0]?.secure_url ||
      data?.pictures?.[0]?.url ||
      data?.pictures?.[0] ||
      "";

    if (el.thumb) {
      if (thumb) {
        el.thumb.src = thumb;
        el.thumb.style.display = "block";
        if (el.photoPh) el.photoPh.style.display = "none";
      } else {
        el.thumb.removeAttribute("src");
        el.thumb.style.display = "none";
        if (el.photoPh) el.photoPh.style.display = "flex";
      }
    }

    setText(
      el.lastUpdate,
      data?.meta?.fetched_at ? `Atualizado em ${fmtDateTime(data.meta.fetched_at)}` : ""
    );
  }

  // --------------------------
  // InfoList unificado (sem repetidos)
  // Não repetir: título, tipo, preço, estoque, vendidos, criado, premium, catálogo, visitas, frete
  // Aqui entram: status, permalink, categoria, condição, moeda, atualizado, seller detalhado, reputação detalhada etc.
  // --------------------------
  function renderInfoList(data) {
    if (!el.infoList) return;

    const s = data?.summary || {};
    const seller = data?.seller || {};
    const rep = data?.seller_reputation || {};

    // Monta só o que é “complementar” e útil
    const pairs = [
      ["MLB", s.id],
      ["Status", s.status],
      ["Permalink", s.permalink],
      ["Categoria", s.category_id],
      ["Condição", s.condition],
      ["Moeda", s.currency_id],
      ["Atualizado em", s.last_updated ? fmtDateTime(s.last_updated) : "—"],

      // Vendedor (detalhe completo)
      [
        "Vendedor",
        seller.nickname
          ? `${seller.nickname}${seller.seller_id ? ` • ID ${seller.seller_id}` : ""}`
          : "—",
      ],
      ["Local", seller.location || "—"],
      [
        "Loja oficial",
        seller.official_store != null
          ? seller.official_store
            ? "Sim"
            : "Não"
          : seller.official_store_id != null
          ? "Sim"
          : "—",
      ],

      // Reputação detalhada (sem duplicar “resumo”)
      [
        "Reputação",
        rep.level_id
          ? `${rep.level_id}${rep.power_seller_status ? ` • ${rep.power_seller_status}` : ""}`
          : "—",
      ],
      [
        "Transações",
        rep.transactions
          ? `vendas ${safeStr(rep.transactions.completed)} • canceladas ${safeStr(rep.transactions.canceled)}`
          : "—",
      ],
    ];

    // remove duplicados e valores vazios repetidos
    const seen = new Set();
    const filtered = pairs.filter(([k, v]) => {
      const vv = safeStr(v);
      const key = `${k}::${vv}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    el.infoList.innerHTML = filtered
      .map(([k, v]) => {
        const vv = safeStr(v);

        if (k === "Permalink" && vv !== "—") {
          const safeUrl = escapeHtml(vv);
          return `
            <div class="aa-row">
              <div class="k">${escapeHtml(k)}</div>
              <div class="v"><a href="${safeUrl}" target="_blank" rel="noopener">${safeUrl}</a></div>
            </div>`;
        }

        return `
          <div class="aa-row">
            <div class="k">${escapeHtml(k)}</div>
            <div class="v">${escapeHtml(vv)}</div>
          </div>`;
      })
      .join("");
  }

  function renderJson(data) {
    lastPayload = data || null;
    if (el.jsonPre) el.jsonPre.textContent = JSON.stringify(data || {}, null, 2);
  }

  function renderDiagnostic(data) {
    const s = data?.summary || {};
    const issues = [];

    if (!s.id) issues.push("• Não veio ID do item (MLB).");
    if (s.available_quantity === 0) issues.push("• Estoque zerado (available_quantity=0).");
    if (s.status && s.status !== "active") issues.push(`• Status diferente de active: ${s.status}`);
    if (s.catalog_listing === false) issues.push("• Não é item de catálogo (catalog_listing=false).");
    if (s.is_premium === false) issues.push("• Não está Premium.");
    if (data?.visits?.total == null) issues.push("• Visitas não carregaram (ver endpoint visits).");

    const hasZip = String(el.zip?.value || "").trim().length > 0;
    if (hasZip && data?.shipping == null) issues.push("• Frete não carregou (ver shipping_options + cep).");

    const out = issues.length
      ? `Encontramos alguns pontos:\n\n${issues.join("\n")}`
      : "Tudo ok ✅ (sem alertas básicos).";

    if (el.diagBox) el.diagBox.textContent = out;
  }

  // --------------------------
  // Fetch JSON com proteção contra HTML/redirect
  // --------------------------
  async function fetchJson(url) {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "follow",
      headers: { Accept: "application/json" },
    });

    const ct = (r.headers.get("content-type") || "").toLowerCase();

    if (r.status === 401) throw new Error("401: Não autorizado. Faça login novamente.");
    if (r.status === 403) throw new Error("403: Sem permissão para acessar este recurso.");
    if (r.status === 404) throw new Error("Rota não encontrada");

    if (!ct.includes("application/json")) {
      const txt = await r.text().catch(() => "");
      const looksHtml = txt && txt.toLowerCase().includes("<html");
      const maybeRedirected = r.url && !r.url.includes("/api/analise-anuncios/");

      if (looksHtml || maybeRedirected) {
        throw new Error(
          "Sessão expirou ou você caiu em redirect (login/select-conta). Refaça login e selecione a conta."
        );
      }
      throw new Error(`Resposta não-JSON (${ct || "sem content-type"}).`);
    }

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      const msg =
        data?.error ||
        data?.message ||
        `HTTP ${r.status}${r.statusText ? ` (${r.statusText})` : ""}`;
      throw new Error(msg);
    }

    // backend pode devolver {ok:true, ...}
    return data;
  }

  async function loadOverview() {
    setAlert(null);

    const raw = el.mlbInput?.value || "";
    const mlb = parseFirstMlb(raw);
    if (!mlb) {
      setAlert("error", "Informe um MLB válido (ex: MLB123...).");
      return;
    }

    if (el.mlbInput) el.mlbInput.value = mlb;

    const days = Number(el.days?.value || 30);
    const zip = String(el.zip?.value || "").trim();

    const url =
      `${API_BASE}/overview/${encodeURIComponent(mlb)}` +
      `?days=${encodeURIComponent(days)}` +
      `&zip_code=${encodeURIComponent(zip)}`;

    if (el.btnLoad) el.btnLoad.disabled = true;

    try {
      const data = await fetchJson(url);

      setChips({ mlb, status: data?.summary?.status || "—" });

      renderSummary(data);
      renderInfoList(data);
      renderJson(data);
      renderDiagnostic(data);

      if (el.btnDiag) el.btnDiag.disabled = false;
      setAlert("ok", "Dados carregados com sucesso.");
    } catch (err) {
      console.error("loadOverview:", err);

      setChips({ mlb, status: "—" });
      renderSummary({});
      renderInfoList({});
      renderJson({});
      renderDiagnostic({});

      setAlert("error", err.message || "Erro ao carregar.");
      if (el.btnDiag) el.btnDiag.disabled = true;
    } finally {
      if (el.btnLoad) el.btnLoad.disabled = false;
    }
  }

  function bindTabs() {
    const tabs = qsa(".inner-tab");

    const panels = {
      details: $("panel-details"),
      diagnostic: $("panel-diagnostic"),
      json: $("panel-json"),
    };

    if (!tabs.length) return;

    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");

        const key = t.dataset.tab;
        Object.entries(panels).forEach(([k, p]) => {
          if (!p) return;
          if (k === key) p.classList.add("active");
          else p.classList.remove("active");
        });
      });
    });
  }

  async function copyJson() {
    if (!lastPayload) {
      setAlert("error", "Não há JSON carregado para copiar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
      setAlert("ok", "JSON copiado ✅");
      setTimeout(() => setAlert(null), 1400);
    } catch {
      setAlert("error", "Não foi possível copiar. Clipboard bloqueado no browser.");
    }
  }

  function clearAll() {
    if (el.mlbInput) el.mlbInput.value = "";
    if (el.zip) el.zip.value = "";
    if (el.days) el.days.value = "30";

    setChips({ mlb: "", status: "" });
    setAlert(null);

    ["sumTitle", "sumType", "sumPrice", "sumStock", "sumSold", "sumCreated"].forEach((id) =>
      setText($(id), "—")
    );

    // pills / indicadores
    setPill(el.pillPremium, { on: null, unknownLabel: "Tipo —" });
    setPill(el.pillCatalog, { on: null, unknownLabel: "Catálogo —" });
    setPill(el.pillOfficial, { on: null, unknownLabel: "Loja —" });
    setPill(el.pillFreeShip, { on: null, unknownLabel: "Frete —" });

    setText(el.kpiVisits, "—");
    setText(el.kpiConversion, "—");
    setText(el.kpiSalesPerDay, "—");
    setText(el.kpiSalesPerMonth, "—");
    setText(el.kpiSaleEvery, "—");
    setText(el.kpiFreteVal, "—");
    setText(el.faturandoVal, "—");

    if (el.thumb) {
      el.thumb.removeAttribute("src");
      el.thumb.style.display = "none";
    }
    if (el.photoPh) el.photoPh.style.display = "flex";

    if (el.infoList) el.infoList.innerHTML = "";
    if (el.jsonPre) el.jsonPre.textContent = "{}";
    if (el.diagBox) el.diagBox.textContent = "Carregue um anúncio para ver o diagnóstico.";
    if (el.lastUpdate) el.lastUpdate.textContent = "";

    lastPayload = null;
    if (el.btnDiag) el.btnDiag.disabled = true;

    const detailsTab = document.querySelector('.inner-tab[data-tab="details"]');
    if (detailsTab) detailsTab.click();
  }

  function bind() {
    bindTabs();

    el.btnLoad?.addEventListener("click", loadOverview);

    el.btnDiag?.addEventListener("click", () => {
      const tab = document.querySelector('.inner-tab[data-tab="diagnostic"]');
      if (tab) tab.click();
    });

    el.btnCopy?.addEventListener("click", copyJson);
    el.btnCopy2?.addEventListener("click", copyJson);

    el.btnClear?.addEventListener("click", clearAll);

    el.mlbInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        loadOverview();
      }
    });

    // Suporte: ?mlb=MLB...
    try {
      const usp = new URLSearchParams(location.search);
      const q = usp.get("mlb") || "";
      const mlb = parseFirstMlb(q);
      if (mlb && el.mlbInput) {
        el.mlbInput.value = mlb;
        loadOverview();
      }
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    setChips({ mlb: "", status: "" });
    if (el.btnDiag) el.btnDiag.disabled = true;
    bind();
  });
})();
