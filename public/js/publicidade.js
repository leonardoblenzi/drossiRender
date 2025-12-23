// public/js/publicidade.js
(() => {
  console.log("🚀 publicidade.js carregado");

  // ==========================================
  // Helpers
  // ==========================================
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const esc = (s) =>
    s == null
      ? ""
      : String(s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#039;",
            }[c])
        );

  const fmtMoney = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const fmtNumber = (v, d = 0) => {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  };

  const fmtPct = (v, d = 2) => {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return `${n.toFixed(d).replace(".", ",")}%`;
  };

  const fmtRatioX = (v, d = 2) => {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return `${fmtNumber(n, d)}x`;
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  function parseDateBr(isoLike) {
    if (!isoLike) return null;
    // aceita "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm:ssZ"
    const s = String(isoLike);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const [, y, mm, dd] = m;
    return `${dd}/${mm}/${y}`;
  }

  function getDateRange() {
    const inpFrom = qs("#dateFrom");
    const inpTo = qs("#dateTo");

    let from = inpFrom?.value || addDays(-30);
    let to = inpTo?.value || todayISO();

    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    if (inpFrom) inpFrom.value = from;
    if (inpTo) inpTo.value = to;

    return { from, to };
  }

  function setLoadingTable(tbody, msg = "Carregando…") {
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="99" class="muted">${esc(
      msg
    )}</td></tr>`;
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  // ==========================================
  // Estado
  // ==========================================
  const state = {
    date_from: null,
    date_to: null,
    campaigns: [],
    itemsByCampaign: new Map(), // campaign_id -> { date_from, date_to, items }
    selectedCampaignId: null,
    selectedRowEl: null,
    chart: null,
    chartSeries: [],
    itemsPage: 1,
    itemsPerPage: 20,
  };

  // ==========================================
  // DOM hooks
  // ==========================================
  const $campBody = () => qs("#tbodyCampaigns");
  const $itemsBody = () => qs("#tbodyItems");
  const $btnExport = () => qs("#btnExportCsv");
  const $pagination = () => qs("#adsPagination");

  // ==========================================
  // UI helpers: pills + seleção de linha
  // ==========================================
  function pillStatus(statusRaw) {
    const s = String(statusRaw || "").toLowerCase();
    const label = statusRaw ? String(statusRaw) : "—";

    if (s === "active" || s === "enabled" || s === "on") {
      return `<span class="pill pill--active">● ${esc(label)}</span>`;
    }
    if (s === "paused" || s === "disabled" || s === "off") {
      return `<span class="pill pill--paused">● ${esc(label)}</span>`;
    }
    return `<span class="pill">${esc(label)}</span>`;
  }

  function pillStrategy(strategyRaw) {
    const s = String(strategyRaw || "").toLowerCase();
    const label = strategyRaw ? String(strategyRaw) : "—";

    if (s.includes("profit"))
      return `<span class="pill pill--profit">${esc(label)}</span>`;
    if (s.includes("increase"))
      return `<span class="pill pill--inc">${esc(label)}</span>`;
    return `<span class="pill">${esc(label)}</span>`;
  }

  function setSelectedCampaignRow(trEl) {
    const tbody = $campBody();
    if (!tbody || !trEl) return;

    qsa(
      'tr[data-camp-id].is-selected, tr[data-camp-id][aria-selected="true"]',
      tbody
    ).forEach((tr) => {
      tr.classList.remove("is-selected");
      tr.removeAttribute("aria-selected");
      tr.tabIndex = -1;
    });

    trEl.classList.add("is-selected");
    trEl.setAttribute("aria-selected", "true");
    trEl.tabIndex = 0;

    state.selectedRowEl = trEl;
  }

  // ==========================================
  // RESUMO GERAL (cards do topo)
  // ==========================================
  function atualizarResumoGeral() {
    const list = state.campaigns || [];
    if (!list.length) {
      setText("sumCost", "R$ 0,00");
      setText("sumClicks", "0");
      setText("sumPrints", "0");
      setText("avgCtr", "0,00%");
      setText("avgAcos", "0,00%");
      setText("avgRoas", "0,00x");
      setText("sumUnits", "0");
      setText("sumAmount", "R$ 0,00");
      return;
    }

    let clicks = 0;
    let prints = 0;
    let cost = 0;
    let units = 0;
    let amount = 0;

    for (const c of list) {
      const m = c.metrics || {};
      clicks += Number(m.clicks || 0);
      prints += Number(m.prints || 0);
      cost += Number(m.cost || 0);
      units += Number(m.units_quantity || 0);
      amount += Number(m.total_amount || 0);
    }

    const ctr = prints > 0 ? (clicks / prints) * 100 : 0;
    const acos = amount > 0 ? (cost / amount) * 100 : 0;
    const roas = cost > 0 ? amount / cost : 0;

    setText("sumCost", fmtMoney(cost));
    setText("sumClicks", fmtNumber(clicks));
    setText("sumPrints", fmtNumber(prints));
    setText("avgCtr", fmtPct(ctr));
    setText("avgAcos", fmtPct(acos));
    setText("avgRoas", `${fmtNumber(roas || 0, 2)}x`);
    setText("sumUnits", fmtNumber(units));
    setText("sumAmount", fmtMoney(amount));
  }

  // ==========================================
  // Fetch – campanhas
  // ==========================================
  async function carregarCampanhas() {
    const tbody = $campBody();
    const { from, to } = getDateRange();
    state.date_from = from;
    state.date_to = to;

    setText("rankingPeriod", `Período: ${from} a ${to}`);
    setLoadingTable(tbody, `Carregando campanhas de ${from} até ${to}…`);

    const url = `/api/publicidade/product-ads/campaigns?date_from=${encodeURIComponent(
      from
    )}&date_to=${encodeURIComponent(to)}`;

    try {
      const r = await fetch(url, { credentials: "same-origin" });
      const txt = await r.text().catch(() => "");

      if (!r.ok) {
        console.error("Erro ao carregar campanhas:", r.status, txt);
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="99" class="muted">Falha ao carregar campanhas (HTTP ${r.status}).</td></tr>`;
        }
        state.campaigns = [];
        atualizarResumoGeral();
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
      state.campaigns = campaigns;

      renderCampanhas();
      atualizarResumoGeral();

      const itemsBody = $itemsBody();
      if (!campaigns.length) {
        if (itemsBody) {
          itemsBody.innerHTML = `<tr><td colspan="99" class="muted">Nenhuma campanha encontrada no período.</td></tr>`;
        }
        const btn = $btnExport();
        if (btn) btn.disabled = true;
        return;
      }

      const hasSelected = campaigns.some(
        (c) => String(c.id) === String(state.selectedCampaignId)
      );
      if (!state.selectedCampaignId || !hasSelected) {
        selecionarCampanha(campaigns[0].id, { scroll: false });
      } else {
        const tbodyNow = $campBody();
        const tr = tbodyNow?.querySelector(
          `tr[data-camp-id="${CSS.escape(String(state.selectedCampaignId))}"]`
        );
        if (tr) setSelectedCampaignRow(tr);
        carregarItensCampanha(String(state.selectedCampaignId));
      }
    } catch (e) {
      console.error("Erro inesperado ao buscar campanhas:", e);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="99" class="muted">Erro ao buscar campanhas (ver console).</td></tr>`;
      }
    }
  }

  function renderCampanhas() {
    const tbody = $campBody();
    if (!tbody) return;

    const list = state.campaigns || [];
    if (!list.length) {
      // ajuste o colspan conforme a quantidade REAL de colunas do seu <thead>
      tbody.innerHTML = `<tr><td colspan="13" class="muted">Nenhuma campanha para o período selecionado.</td></tr>`;
      return;
    }

    const rows = list
      .map((c) => {
        const m = c.metrics || {};
        const isSelected = String(state.selectedCampaignId) === String(c.id);

        const acosObj = c.acos_target != null ? fmtPct(c.acos_target) : "—";
        const acosVal = m.acos != null ? fmtPct(m.acos) : "—";

        const prints = Number(m.prints || 0);
        const cost = Number(m.cost || 0);

        const vendasPublicidade = fmtNumber(m.units_quantity ?? 0);
        const investimento = fmtMoney(cost);

        const cpc = m.cpc != null ? fmtMoney(m.cpc) : "—";
        const ctrVal = m.ctr != null ? fmtPct(m.ctr) : "—";

        const receita = m.total_amount != null ? fmtMoney(m.total_amount) : "—";
        const roas =
          m.roas != null
            ? fmtRatioX(m.roas, 2)
            : cost > 0
            ? fmtRatioX(Number(m.total_amount || 0) / cost || 0, 2)
            : "—";

        // ======================================================
        // ✅ NOVO: adgroups_count + created_at (vindos do backend)
        // Backend recomendado: c.created_at e c.adgroups_count
        // ======================================================
        const adgroupsCountRaw =
          c.adgroups_count ??
          c.adgroupsCount ??
          c.ad_groups_count ??
          c.adGroupsCount ??
          null;

        const adgroupsCount =
          adgroupsCountRaw != null && isFinite(Number(adgroupsCountRaw))
            ? Number(adgroupsCountRaw)
            : null;

        const createdRaw =
          c.created_at ??
          c.date_created ??
          c.created_at ??
          c.createdAt ??
          c.meliCreatedAt ??
          null;

        const createdBr = parseDateBr(createdRaw);

        const sub1 =
          adgroupsCount != null ? `${adgroupsCount} adgroups` : "— adgroups";

        const sub2 = createdBr
          ? `Data de criação: ${createdBr}`
          : "Data de criação: —";

        const trAttrs = [
          `data-camp-id="${esc(c.id)}"`,
          `role="row"`,
          `tabindex="${isSelected ? "0" : "-1"}"`,
          isSelected ? `aria-selected="true"` : `aria-selected="false"`,
          `title="Clique para ver os anúncios desta campanha"`,
        ].join(" ");

        return `
        <tr ${trAttrs} class="${isSelected ? "is-selected" : ""}">
          <td class="sticky-col">
            <div class="camp-name">
              <span class="camp-title">${esc(c.name || c.id || "—")}</span>

              <!-- sublinhas estilo "minimalista" -->
              <div class="camp-sub">
                <span class="camp-sub__line">${esc(sub1)}</span>
                <span class="camp-sub__line">${esc(sub2)}</span>
              </div>
            </div>
          </td>

          <td>${pillStatus(c.status)}</td>
          <td>${pillStrategy(c.strategy)}</td>

          <td class="num">${acosObj}</td>
          <td class="num">${acosVal}</td>

          <!-- ✅ aqui ficam só as colunas que você manteve -->
          <td class="num">${vendasPublicidade}</td>
          <td class="num">${fmtNumber(prints)}</td>
          <td class="num">${fmtNumber(m.clicks ?? 0)}</td>
          <td class="num">${investimento}</td>
          <td class="num">${cpc}</td>
          <td class="num">${ctrVal}</td>
          <td class="num">${receita}</td>
          <td class="num">${roas}</td>
        </tr>
      `;
      })
      .join("");

    tbody.innerHTML = rows;

    // Delegação: clique + teclado
    tbody.onclick = (ev) => {
      const tr = ev.target.closest("tr[data-camp-id]");
      if (!tr) return;
      const id = tr.getAttribute("data-camp-id");
      if (!id) return;
      selecionarCampanha(id, { rowEl: tr });
    };

    tbody.onkeydown = (ev) => {
      const tr = ev.target.closest("tr[data-camp-id]");
      if (!tr) return;

      // Enter / Space seleciona
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        const id = tr.getAttribute("data-camp-id");
        if (!id) return;
        selecionarCampanha(id, { rowEl: tr, scroll: false });
        return;
      }

      // setas navegam na lista
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const all = qsa("tr[data-camp-id]", tbody);
        const idx = all.indexOf(tr);
        if (idx === -1) return;

        const nextIdx =
          ev.key === "ArrowDown"
            ? Math.min(all.length - 1, idx + 1)
            : Math.max(0, idx - 1);

        const next = all[nextIdx];
        if (next) next.focus();
      }
    };

    // garantir marca visual da selecionada após render
    if (state.selectedCampaignId) {
      const tr = tbody.querySelector(
        `tr[data-camp-id="${CSS.escape(String(state.selectedCampaignId))}"]`
      );
      if (tr) setSelectedCampaignRow(tr);
    }
  }

  // ==========================================
  // Seleção de campanha
  // ==========================================
  function selecionarCampanha(campaignId, opts = {}) {
    const id = String(campaignId || "");
    if (!id) return;

    state.selectedCampaignId = id;
    state.itemsPage = 1;

    const tbody = $campBody();
    const rowEl =
      opts.rowEl ||
      tbody?.querySelector(`tr[data-camp-id="${CSS.escape(id)}"]`) ||
      null;

    if (rowEl) {
      setSelectedCampaignRow(rowEl);
      if (opts.scroll !== false) {
        rowEl.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    }

    carregarItensCampanha(id);

    const btn = $btnExport();
    if (btn) btn.disabled = false;
  }

  // ==========================================
  // Fetch – itens da campanha
  // ==========================================
  async function carregarItensCampanha(campaignId) {
    const tbody = $itemsBody();
    const pag = $pagination();
    if (pag) pag.innerHTML = "";
    if (!tbody) return;

    if (!campaignId) {
      tbody.innerHTML = `<tr><td colspan="16" class="muted">Selecione uma campanha.</td></tr>`;
      return;
    }

    const from = state.date_from || addDays(-30);
    const to = state.date_to || todayISO();

    const cached = state.itemsByCampaign.get(String(campaignId));
    if (cached && cached.date_from === from && cached.date_to === to) {
      renderItens(cached.items);
      return;
    }

    setLoadingTable(tbody, "Carregando itens da campanha…");

    const url = `/api/publicidade/product-ads/campaigns/${encodeURIComponent(
      campaignId
    )}/items?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(
      to
    )}`;

    try {
      const r = await fetch(url, { credentials: "same-origin" });
      const txt = await r.text().catch(() => "");

      if (!r.ok) {
        console.error("Erro ao carregar itens da campanha:", r.status, txt);
        tbody.innerHTML = `<tr><td colspan="16" class="muted">Falha ao carregar itens (HTTP ${r.status}).</td></tr>`;
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const items = Array.isArray(data.items) ? data.items : [];

      state.itemsByCampaign.set(String(campaignId), {
        date_from: from,
        date_to: to,
        items,
      });

      state.itemsPage = 1;
      renderItens(items);
    } catch (e) {
      console.error("Erro inesperado ao buscar itens da campanha:", e);
      tbody.innerHTML = `<tr><td colspan="16" class="muted">Erro ao buscar itens (ver console).</td></tr>`;
    }
  }

  // ==========================================
  // Itens (paginação + render)
  // ==========================================
  function renderItensPagination(totalItems) {
    const container = $pagination();
    if (!container) return;

    const perPage = state.itemsPerPage;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const current = Math.min(Math.max(1, state.itemsPage), totalPages);

    container.innerHTML = `
      <button data-page="prev" ${current === 1 ? "disabled" : ""}>‹</button>
      <button disabled style="opacity:.85; cursor:default;">Página ${current} de ${totalPages}</button>
      <button data-page="next" ${
        current === totalPages ? "disabled" : ""
      }>›</button>
    `;

    container.onclick = (ev) => {
      const btn = ev.target.closest("[data-page]");
      if (!btn) return;

      const type = btn.getAttribute("data-page");
      if (type === "prev" && state.itemsPage > 1) state.itemsPage -= 1;
      else if (type === "next" && state.itemsPage < totalPages)
        state.itemsPage += 1;
      else return;

      const campId = state.selectedCampaignId;
      if (!campId) return;
      const cached = state.itemsByCampaign.get(String(campId));
      if (!cached) return;
      renderItens(cached.items);
    };
  }

  function detectQuality(it) {
    const raw =
      it.publication_quality ??
      it.quality ??
      it.listing_quality ??
      it.health ??
      null;

    if (raw == null) return { cls: "quality-badge--na", label: "N/D" };

    const n = Number(raw);
    if (isFinite(n)) {
      if (n >= 80)
        return { cls: "quality-badge--good", label: String(Math.round(n)) };
      if (n >= 50)
        return { cls: "quality-badge--medium", label: String(Math.round(n)) };
      return { cls: "quality-badge--na", label: String(Math.round(n)) };
    }

    const s = String(raw).toLowerCase();
    if (s.includes("good") || s.includes("high") || s.includes("excel"))
      return { cls: "quality-badge--good", label: "Boa" };
    if (s.includes("med") || s.includes("mid"))
      return { cls: "quality-badge--medium", label: "Média" };
    return { cls: "quality-badge--na", label: esc(String(raw)).slice(0, 6) };
  }

  function renderItens(items) {
    const tbody = $itemsBody();
    if (!tbody) return;

    if (!items || !items.length) {
      tbody.innerHTML = `<tr><td colspan="16" class="muted">Nenhum item com métricas para esta campanha no período.</td></tr>`;
      renderItensPagination(0);
      return;
    }

    const perPage = state.itemsPerPage;
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, state.itemsPage), totalPages);
    state.itemsPage = page;

    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pageItems = items.slice(start, end);

    const rows = pageItems
      .map((it) => {
        const m = it.metrics || {};

        // Base
        const prints = Number(m.prints ?? 0);
        const clicks = Number(m.clicks ?? 0);

        const ctrVal =
          m.ctr != null
            ? fmtPct(m.ctr)
            : prints > 0
            ? fmtPct((clicks / prints) * 100)
            : "—";
        const cpcVal =
          m.cpc != null
            ? fmtMoney(m.cpc)
            : it.cpc != null
            ? fmtMoney(it.cpc)
            : "—";

        const acosVal = m.acos != null ? fmtPct(m.acos) : "—";
        const tacosVal = m.tacos != null ? fmtPct(m.tacos) : "—";
        const roasVal = m.roas != null ? fmtRatioX(m.roas, 2) : "—";

        // Conversão publicitária (units/clicks)
        const unitsQ = Number(m.units_quantity ?? 0);
        const convRate =
          m.conversion_rate != null
            ? fmtPct(Number(m.conversion_rate) * 100)
            : clicks > 0 && unitsQ >= 0
            ? fmtPct((unitsQ / clicks) * 100)
            : "—";

        // Vendas (valores) — tenta várias chaves comuns
        const vendasPublicidadeVal =
          m.total_amount != null ? fmtMoney(m.total_amount) : "—";
        const vendasDiretasVal =
          m.direct_amount != null ? fmtMoney(m.direct_amount) : "—";
        const vendasAssistidasVal =
          m.indirect_amount != null ? fmtMoney(m.indirect_amount) : "—";

        // Aporte de publicidade (unidades anunciadas) — fallback: units_quantity
        const aportePublicidade =
          m.organic_units_amount != null
            ? fmtNumber(m.organic_units_amount)
            : m.units_quantity != null
            ? fmtNumber(m.units_quantity)
            : "—";

        // Renda por publicidade (receita por unidade) — total_amount / units_quantity
        const rendaPublicidade =
          Number(m.total_amount ?? NaN) > 0 && Number(m.units_quantity ?? 0) > 0
            ? fmtMoney(Number(m.total_amount) / Number(m.units_quantity))
            : "—";

        // Investimento
        const investimentoVal = m.cost != null ? fmtMoney(m.cost) : "—";

        const statusRaw = it.status || it.item_status || "—";
        const statusClass =
          String(statusRaw).toLowerCase() === "active"
            ? "is-active"
            : String(statusRaw).toLowerCase() === "paused"
            ? "is-paused"
            : "";

        const q = detectQuality(it);

        const title = it.title || it.name || "—";
        const sku = it.sku || it.seller_sku || "—";
        const mlb = it.item_id || it.id || "—";

        const firstLetter = String(title).trim().charAt(0).toUpperCase() || "P";

        const thumbHtml = it.thumbnail
          ? `<img src="${esc(it.thumbnail)}" alt="${esc(
              title
            )}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">`
          : `<span style="font-weight:800;">${esc(firstLetter)}</span>`;

        return `
        <tr class="ads-item-row" data-item-id="${esc(mlb)}">
          <td class="sticky-col">
            <div class="ads-item-product">
              <div class="ads-item-thumb">
                ${thumbHtml}
              </div>
              <div class="ads-item-info">
                <div class="ads-item-title" title="${esc(title)}">${esc(
          title
        )}</div>
                <div class="ads-item-meta">
                  <span>SKU: ${esc(sku)}</span>
                  <span>MLB: ${esc(mlb)}</span>
                  <span class="ads-item-status ${statusClass}">${esc(
          statusRaw
        )}</span>
                </div>
              </div>
            </div>
          </td>

          <td class="num">
            <div class="quality-badge ${q.cls}" title="Qualidade da publicação">
              ${esc(q.label)}
            </div>
          </td>

          <!-- ordem solicitada -->
          <td class="num">${acosVal}</td>
          <td class="num">${tacosVal}</td>
          <td class="num">${roasVal}</td>

          <td class="num">${fmtNumber(prints)}</td>
          <td class="num">${fmtNumber(clicks)}</td>
          <td class="num">${ctrVal}</td>
          <td class="num">${cpcVal}</td>

          <td class="num">${convRate}</td>
          <td class="num">${vendasPublicidadeVal}</td>
          <td class="num">${vendasDiretasVal}</td>
          <td class="num">${vendasAssistidasVal}</td>

          <td class="num">${aportePublicidade}</td>
          <td class="num">${rendaPublicidade}</td>
          <td class="num">${investimentoVal}</td>
        </tr>
      `;
      })
      .join("");

    tbody.innerHTML = rows;
    renderItensPagination(total);
  }

  // ==========================================
  // MÉTRICAS DIÁRIAS (gráfico)
  // ==========================================
  async function carregarMetricasDiarias() {
    const canvas = document.getElementById("adsMetricsChart");
    if (!canvas) return;

    const { from, to } = getDateRange();
    state.date_from = from;
    state.date_to = to;
    setText("rankingPeriod", `Período: ${from} a ${to}`);

    const url = `/api/publicidade/product-ads/metrics/daily?date_from=${encodeURIComponent(
      from
    )}&date_to=${encodeURIComponent(to)}`;

    try {
      const r = await fetch(url, { credentials: "same-origin" });
      const txt = await r.text().catch(() => "");

      if (!r.ok) {
        console.error("Erro ao carregar métricas diárias:", r.status, txt);
        atualizarGrafico([]);
        return;
      }

      const data = txt ? JSON.parse(txt) : {};
      const series = Array.isArray(data.results || data.series)
        ? data.results || data.series
        : [];

      state.chartSeries = series;
      atualizarGrafico(series);
    } catch (e) {
      console.error("Erro inesperado ao carregar métricas diárias:", e);
      if (state.chart) {
        try {
          state.chart.destroy();
        } catch (_) {}
        state.chart = null;
      }
    }
  }

  function atualizarGrafico(series) {
    const canvas = document.getElementById("adsMetricsChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      console.warn(
        "Chart.js não carregado – gráfico de métricas não será exibido."
      );
      return;
    }

    if (!series || !series.length) {
      if (state.chart) {
        state.chart.destroy();
        state.chart = null;
      }
      return;
    }

    const labels = series.map((row) => {
      const d = row.date || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const [y, m, day] = d.split("-");
      return `${day}/${m}`;
    });

    const impressions = series.map((r) => Number(r.prints || 0));
    const clicks = series.map((r) => Number(r.clicks || 0));
    const cost = series.map((r) => Number(r.cost || 0));
    const revenue = series.map((r) => Number(r.total_amount || 0));

    const ctx = canvas.getContext("2d");

    const datasets = [
      {
        label: "Impressões",
        data: impressions,
        yAxisID: "y2",
        borderWidth: 2,
        tension: 0.3,
      },
      {
        label: "Cliques",
        data: clicks,
        yAxisID: "y1",
        borderWidth: 2,
        tension: 0.3,
      },
      {
        label: "Investimento",
        data: cost,
        yAxisID: "y1",
        borderWidth: 2,
        tension: 0.3,
      },
      {
        label: "Faturamento",
        data: revenue,
        yAxisID: "y1",
        borderWidth: 2,
        tension: 0.3,
      },
    ];

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets = datasets;
      state.chart.update();
      return;
    }

    state.chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          y1: {
            type: "linear",
            position: "left",
            ticks: {
              callback(value) {
                return Number(value).toLocaleString("pt-BR");
              },
            },
          },
          y2: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: {
              callback(value) {
                return Number(value).toLocaleString("pt-BR");
              },
            },
          },
        },
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  // ==========================================
  // Eventos de UI
  // ==========================================
  function bindUI() {
    const form = qs("#ads-filters");
    if (form) {
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        carregarCampanhas();
        carregarMetricasDiarias();
      });
    }

    const btnReload = qs("#btnReloadAds");
    if (btnReload) {
      btnReload.addEventListener("click", (ev) => {
        ev.preventDefault();
        carregarCampanhas();
        carregarMetricasDiarias();
      });
    }

    const btnExport = $btnExport();
    if (btnExport) {
      btnExport.disabled = true;
      btnExport.addEventListener("click", () => {
        const id = state.selectedCampaignId;
        if (!id) return;

        const { from, to } = getDateRange();

        // NOVO endpoint (botão no topo da tabela de anúncios)
        const url =
          `/api/publicidade/product-ads/campaigns/${encodeURIComponent(
            id
          )}/items/export.csv` +
          `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(
            to
          )}`;

        // baixa em nova aba (simples e confiável)
        window.open(url, "_blank");
      });
    }
  }

  // ==========================================
  // Boot
  // ==========================================
  document.addEventListener("DOMContentLoaded", () => {
    try {
      getDateRange();
      bindUI();
      carregarCampanhas();
      carregarMetricasDiarias();
    } catch (e) {
      console.error("Erro ao inicializar publicidade.js:", e);
    }
  });
})();
