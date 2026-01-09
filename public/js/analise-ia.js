(() => {
  const $ = (id) => document.getElementById(id);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  const el = {
    mlbInput: $("mlbInput"),
    days: $("daysSelect"),
    zip: $("zipInput"),

    photoWrap: document.getElementById("aaPhotoWrap"),
    photoPh: document.getElementById("aaPhotoPlaceholder"),

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

    sumTitle: $("sumTitle"),
    sumType: $("sumType"),
    sumPrice: $("sumPrice"),
    sumStock: $("sumStock"),
    sumSold: $("sumSold"),
    sumCreated: $("sumCreated"),
    sumPremium: $("sumPremium"),
    sumCatalog: $("sumCatalog"),
    sumVisits: $("sumVisits"),
    sumShipping: $("sumShipping"),
    sumSeller: $("sumSeller"),
    sumRep: $("sumRep"),

    lastUpdate: $("lastUpdateInfo"),
    thumb: $("itemThumb"),
    infoList: $("infoList"),
    jsonPre: $("jsonPre"),
    diagBox: $("diagBox"),
  };

  // ✅ Endpoint base (precisa existir no backend)
  const API_BASE = "/api/analise-anuncios";

  let lastPayload = null;

  function show(elm) {
    if (elm) elm.classList.remove("d-none");
  }
  function hide(elm) {
    if (elm) elm.classList.add("d-none");
  }
  function setText(elm, v) {
    if (elm) elm.textContent = v == null || v === "" ? "—" : String(v);
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

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("pt-BR");
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
    // chipConta é preenchido pelo account-bar.js (data-account-label).
  }

  function renderSummary(data) {
    const s = data?.summary || {};

    setText(el.sumTitle, s.title);
    setText(el.sumType, s.listing_type_id || s.listing_type || "—");

    setText(el.sumPrice, fmtMoneyBRL(s.price));
    setText(el.sumStock, s.available_quantity ?? "—");

    const sold = s.sold_quantity ?? s.sold ?? "—";
    setText(el.sumSold, sold);

    setText(el.sumCreated, s.date_created ? fmtDateTime(s.date_created) : "—");
    setText(
      el.sumPremium,
      s.is_premium ? "Sim" : s.is_premium === false ? "Não" : "—"
    );
    setText(
      el.sumCatalog,
      s.catalog_listing ? "Sim" : s.catalog_listing === false ? "Não" : "—"
    );

    const visits = data?.visits?.total ?? data?.visits ?? null;
    setText(el.sumVisits, visits == null ? "—" : visits);

    const shipTxt =
      data?.shipping?.free_shipping != null
        ? `${data.shipping.free_shipping ? "Frete grátis" : "Frete pago"}${
            data.shipping.cost != null
              ? ` • ${fmtMoneyBRL(data.shipping.cost)}`
              : ""
          }`
        : "—";
    setText(el.sumShipping, shipTxt);

    const seller = data?.seller || {};
    const sellerTxt = seller.nickname
      ? `${seller.nickname}${
          seller.seller_id ? ` • ID ${seller.seller_id}` : ""
        }${seller.location ? ` • ${seller.location}` : ""}`
      : "—";
    setText(el.sumSeller, sellerTxt);

    const rep = data?.seller_reputation || {};
    const repTxt = rep.level_id
      ? `${rep.level_id}${
          rep.power_seller_status ? ` • ${rep.power_seller_status}` : ""
        }${
          rep.transactions
            ? ` • vendas ${rep.transactions.completed ?? "—"}`
            : ""
        }`
      : "—";
    setText(el.sumRep, repTxt);

    const thumb =
      s.pictures?.[0] || // ✅ capa grande primeiro
      s.thumbnail || // fallback
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
      data?.meta?.fetched_at
        ? `Atualizado em ${fmtDateTime(data.meta.fetched_at)}`
        : ""
    );
  }

  function renderInfoList(data) {
    if (!el.infoList) return;

    const s = data?.summary || {};
    const pairs = [
      ["MLB", s.id],
      ["Status", s.status],
      ["Permalink", s.permalink],
      ["Categoria", s.category_id],
      ["Condição", s.condition],
      ["Moeda", s.currency_id],
      ["Preço", fmtMoneyBRL(s.price)],
      ["Qtd disponível", s.available_quantity],
      ["Qtd vendida", s.sold_quantity],
      ["Tipo anúncio", s.listing_type_id],
      ["Catálogo", s.catalog_listing ? "Sim" : "Não"],
      ["Premium", s.is_premium ? "Sim" : "Não"],
      ["Criado em", fmtDateTime(s.date_created)],
      ["Atualizado em", fmtDateTime(s.last_updated)],
    ];

    el.infoList.innerHTML = pairs
      .map(([k, v]) => {
        const vv = v == null || v === "" ? "—" : String(v);

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
    if (el.jsonPre)
      el.jsonPre.textContent = JSON.stringify(data || {}, null, 2);
  }

  function renderDiagnostic(data) {
    const s = data?.summary || {};
    const issues = [];

    if (!s.id) issues.push("• Não veio ID do item (MLB).");
    if (s.available_quantity === 0)
      issues.push("• Estoque zerado (available_quantity=0).");
    if (s.status && s.status !== "active")
      issues.push(`• Status diferente de active: ${s.status}`);
    if (s.catalog_listing === false)
      issues.push("• Não é item de catálogo (catalog_listing=false).");
    if (s.is_premium === false) issues.push("• Não está Premium.");
    if (data?.visits?.total == null)
      issues.push("• Visitas não carregaram (ver endpoint visits).");
    // shipping só é obrigatório se houver CEP
    const hasZip = String(el.zip?.value || "").trim().length > 0;
    if (hasZip && data?.shipping == null)
      issues.push("• Frete não carregou (ver shipping_options + cep).");

    const out = issues.length
      ? `Encontramos alguns pontos:\n\n${issues.join("\n")}`
      : "Tudo ok ✅ (sem alertas básicos).";

    if (el.diagBox) el.diagBox.textContent = out;
  }

  async function fetchJson(url) {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "follow",
      headers: { Accept: "application/json" },
    });

    // ✅ Se caiu em login/seleção, muitos backends devolvem HTML com 200 (após 302)
    const ct = (r.headers.get("content-type") || "").toLowerCase();

    if (r.status === 401) {
      throw new Error("401: Não autorizado. Faça login novamente.");
    }
    if (r.status === 403) {
      // se seu ensurePermission retorna redirect json, o backend vai mandar isso
      // mas caso venha HTML, mostramos msg padrão
      throw new Error("403: Sem permissão para acessar este recurso.");
    }
    if (r.status === 404) {
      throw new Error("Rota não encontrada");
    }

    if (!ct.includes("application/json")) {
      const txt = await r.text().catch(() => "");
      const looksHtml = txt && txt.toLowerCase().includes("<html");
      const maybeRedirected =
        r.url && !r.url.includes("/api/analise-anuncios/");

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

      // mantém mensagem original quando é a nossa 404
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
      setAlert(
        "error",
        "Não foi possível copiar. Clipboard bloqueado no browser."
      );
    }
  }

  function clearAll() {
    if (el.mlbInput) el.mlbInput.value = "";
    if (el.zip) el.zip.value = "";
    if (el.days) el.days.value = "30";

    setChips({ mlb: "", status: "" });
    setAlert(null);

    [
      "sumTitle",
      "sumType",
      "sumPrice",
      "sumStock",
      "sumSold",
      "sumCreated",
      "sumPremium",
      "sumCatalog",
      "sumVisits",
      "sumShipping",
      "sumSeller",
      "sumRep",
    ].forEach((id) => setText($(id), "—"));

    if (el.thumb) {
      el.thumb.removeAttribute("src");
      el.thumb.style.display = "none";
    }
    if (el.photoPh) el.photoPh.style.display = "flex";

    if (el.infoList) el.infoList.innerHTML = "";
    if (el.jsonPre) el.jsonPre.textContent = "{}";
    if (el.diagBox)
      el.diagBox.textContent = "Carregue um anúncio para ver o diagnóstico.";
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
