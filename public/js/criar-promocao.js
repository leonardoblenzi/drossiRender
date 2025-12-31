// public/js/criar-promocao.js
// ===================== Bootstrap =====================
console.log("🚀 criar-promocao.js carregado");

// =====================================================
// ============ Helpers de HTTP e caminhos =============
// =====================================================

/** Converte caminho relativo em absoluto (mantém http/https) */
const toAbs = (p) =>
  /^https?:\/\//i.test(p) ? p : p.startsWith("/") ? p : `/${p}`;

/**
 * Tenta buscar JSON em uma lista de rotas alternativas, retornando o primeiro sucesso.
 * Loga o motivo de cada falha para facilitar debug.
 */
async function getJSONAny(paths) {
  let lastErr;

  for (const p of paths) {
    const url = toAbs(p);

    try {
      const r = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      // Detecta redirect silencioso (ex: 302 -> /select-conta)
      // fetch segue redirect e r.ok pode ficar true, mas r.url muda
      const finalUrl = r && r.url ? r.url : url;
      const ct = (r.headers.get("content-type") || "").toLowerCase();

      // Se voltou HTML, isso é sintoma clássico de redirect para página
      const looksHtml = ct.includes("text/html");

      if (!r.ok || looksHtml) {
        const body = await r.text().catch(() => "");
        lastErr = new Error(`HTTP ${r.status} ${url}`);

        lastErr.cause = {
          status: r.status,
          url,
          finalUrl,
          contentType: ct,
          body: body ? body.slice(0, 400) : "",
        };

        console.error(`❌ Falha em ${url}`, lastErr.cause);

        // Se o finalUrl “virou” /select-conta ou /login, já sabemos que é problema de sessão/conta
        if (
          String(finalUrl).includes("/select-conta") ||
          String(finalUrl).includes("/login")
        ) {
          console.warn(
            "⚠️ Endpoint devolveu HTML de página (provável redirect do backend):",
            finalUrl
          );
        }
        continue;
      }

      // Aqui é JSON de verdade
      return await r.json();
    } catch (e) {
      lastErr = e;
      console.error("❌ Falha em", url, e?.message || e);
    }
  }

  throw lastErr || new Error("Nenhum endpoint respondeu");
}

// Rotas alternativas — usuários/promos
const usersPaths = () => [
  "/api/promocoes/users",
  "/api/promocao/users",
  "/api/promotions/users",
];

// Rotas alternativas — itens de uma promoção
const itemsPaths = (promotionId, type, qs) => {
  const suffix = `?promotion_type=${encodeURIComponent(type)}&app_version=v2${
    qs ? `&${qs}` : ""
  }`;
  const pid = encodeURIComponent(promotionId);
  return [
    `/api/promocoes/promotions/${pid}/items${suffix}`,
    `/api/promocao/promotions/${pid}/items${suffix}`,
    `/api/promotions/promotions/${pid}/items${suffix}`,
  ];
};

// Rotas para resolver offer_id / candidate_id via backend (quando necessário)
const offerIdsPaths = (mlb) => [
  `/api/promocoes/items/${encodeURIComponent(mlb)}/offer-ids`,
  `/api/promocao/items/${encodeURIComponent(mlb)}/offer-ids`,
  `/api/promotions/items/${encodeURIComponent(mlb)}/offer-ids`,
];

// =====================================================
// ============== DOM / formatação básica ==============
// =====================================================

const PAGE_SIZE = 50;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function esc(s) {
  return s == null
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
}

// Escapa string para uso seguro em inline JS (onclick), sem quebrar aspas
const jsStr = (v) => JSON.stringify(String(v ?? ""));

const fmtMoeda = (n) =>
  n == null || isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtPerc = (n, d = 2) => (n || n === 0 ? `${Number(n).toFixed(d)}%` : "—");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function elCards() {
  return document.getElementById("cards");
}
function elTbody() {
  return document.getElementById("tbody");
}
function elPag() {
  return document.getElementById("paginacao");
}
function getTable() {
  return elTbody()?.closest("table") || null;
}

// =====================================================
// ====================== STATE ========================
// =====================================================

const state = {
  cards: [],
  cardsFilteredIds: null,
  items: [],
  selectedCard: null,
  promotionBenefits: null,
  activeTypeTab: "ALL", // ALL | SMART | DEAL | ...

  filtroParticipacao: "all", // all|yes|non|prog
  maxDesc: null, // percent max (número) para filtro
  mlbFilter: "",

  paging: {
    total: 0,
    limit: PAGE_SIZE,
    tokensByPage: { 1: null }, // paginação por search_after
    currentPage: 1,
    lastPageKnown: 1,
  },

  loading: false,
  searchMlb: null,

  // Sessão de aplicação (para HUD / JobsPanel)
  applySession: {
    started: false,
    totalHint: null,
    processed: 0,
    added: 0,
    changed: 0,
    removed: 0,
    errors: 0,
    lastTitle: "",
  },
};

// =====================================================
// =================== HUD (no-op) =====================
// =====================================================
// Mantido propositalmente como no-op para não quebrar chamadas.
// O progresso visual é feito via JobsPanel.
const HUD = {
  open() {},
  bump() {},
  tickProcessed() {},
  reset() {},
  render() {},
};

// ====== Job title cache (front-only) ======
const JobTitleCache = (() => {
  const KEY = "davanti_job_titles_v1";
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {}

  function set(id, title) {
    if (!id || !title) return;
    map[String(id)] = String(title);
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {}
  }

  function get(id) {
    return map[String(id)] || null;
  }

  return { set, get };
})();

// =====================================================
// ================ Jobs Watcher (poll) ================
// =====================================================

const JobsWatcher = (function () {
  let timer = null;
  let periodMs = 3000;

  let idleTicks = 0;
  const IDLE_TICKS_TO_STOP = 3; // para depois de 3 polls "sem jobs ativos"

  const ACTIVE_PERIOD = 3000;
  const IDLE_PERIOD = 12000;
  const HIDDEN_PERIOD = 20000;

  function normalizeJobState(job) {
    const sRaw = String(job?.state || job?.status || "").toLowerCase();

    const processed = Number(job?.processed ?? 0);
    const total = Number(job?.total ?? 0);

    const progress =
      Number(job?.progress ?? NaN) ||
      (total > 0 ? Math.round((processed / total) * 100) : 0);

    const byCounts = total > 0 && processed >= total && progress >= 100;

    const failed =
      hasErrors ||
      hasErrorsFromText ||
      sRaw.includes("fail") ||
      sRaw.includes("falhou") ||
      sRaw.includes("error"); // <-- removi o "erro" solto daqui

    const canceled =
      sRaw.includes("cancel") ||
      sRaw.includes("canceled") ||
      sRaw.includes("aborted");

    const completed =
      !failed &&
      !canceled &&
      (byCounts ||
        sRaw.includes("conclu") ||
        sRaw.includes("completed") ||
        sRaw.includes("done") ||
        sRaw.includes("finaliz"));

    if (failed) return { state: "failed", progress, processed, total };
    if (canceled) return { state: "canceled", progress, processed, total };
    if (completed)
      return { state: "completed", progress: 100, processed, total };

    // queued/pending
    if (
      sRaw.includes("queue") ||
      sRaw.includes("waiting") ||
      sRaw.includes("pend") ||
      sRaw.includes("scheduled") ||
      sRaw.includes("agend")
    ) {
      return { state: "queued", progress, processed, total };
    }

    // default: active
    return { state: "active", progress, processed, total };
  }

  function normalizeJob(job) {
    const norm = normalizeJobState(job);
    // Força um formato “compatível” com painéis que esperam state/status padronizado
    return {
      ...job,
      state: norm.state,
      status: norm.state,
      progress: norm.progress,
      processed: norm.processed,
      total: norm.total,
    };
  }

  function anyRunning(list) {
    // considera "queued" também como job vivo
    return list.some((j) => j.state === "active" || j.state === "queued");
  }

  function setPeriod(ms) {
    ms = Number(ms);
    if (!isFinite(ms) || ms <= 0) return;

    if (!timer) {
      periodMs = ms;
      return;
    }
    if (ms === periodMs) return;

    periodMs = ms;
    clearInterval(timer);
    timer = setInterval(poll, periodMs);
  }

  async function poll() {
    try {
      const r = await fetch("/api/promocoes/jobs", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      });
      if (!r.ok) return;

      const data = await r.json().catch(() => ({}));
      const raw = Array.isArray(data?.jobs) ? data.jobs : [];

      const list = raw.map(normalizeJob);

      for (const j of list) {
        const t = JobTitleCache.get(j.id);
        if (t) {
          j.title = j.title || t;
          j.label = j.label || t;
        }
      }

      // Entrega para o painel já normalizado (resolve “concluído” virar “completed”)
      if (window.JobsPanel?.mergeApiJobs && Array.isArray(list)) {
        window.JobsPanel.mergeApiJobs(list);
      }

      const running = anyRunning(list);

      if (running) {
        idleTicks = 0;
        setPeriod(ACTIVE_PERIOD);
        return;
      }

      // Não tem jobs ativos → entra em idle (poll mais lento) e depois para.
      idleTicks++;
      setPeriod(document.hidden ? HIDDEN_PERIOD : IDLE_PERIOD);

      if (idleTicks >= IDLE_TICKS_TO_STOP) {
        stop(); // ✅ PARA o polling automático
      }
    } catch (e) {
      // silencioso
    }
  }

  function start() {
    if (timer) return;
    idleTicks = 0;
    periodMs = document.hidden ? HIDDEN_PERIOD : ACTIVE_PERIOD;
    timer = setInterval(poll, periodMs);
    poll();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function isRunning() {
    return !!timer;
  }

  // Se a aba ficar oculta, reduz frequência
  document.addEventListener("visibilitychange", () => {
    if (!timer) return;
    setPeriod(document.hidden ? HIDDEN_PERIOD : ACTIVE_PERIOD);
  });

  return { start, stop, isRunning, poll };
})();

// =====================================================
// =================== Utils diversos ==================
// =====================================================

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function toNum(x) {
  return x === null || x === undefined || x === "" ? null : Number(x);
}

/** Normaliza nomenclaturas da API para comparações consistentes */
function normalizeStatus(s) {
  s = String(s || "").toLowerCase();

  // compat/alias que às vezes aparece em integrações antigas
  if (s === "in_progress") return "pending";
  if (s === "scheduled") return "pending"; // normaliza "scheduled" para "pending"
  if (s === "programmed") return "pending"; // opcional (robustez)

  return s;
}

/** Deduplica por MLB escolhendo o "status real" com prioridade.
 *  started > pending > candidate > outros
 */
function dedupeByMLB(items, statusFilter) {
  const rank = { started: 3, pending: 2, candidate: 1 };
  const pickRank = (st) => rank[normalizeStatus(st)] ?? 0;

  const map = new Map();
  for (const it of items) {
    const id = String(it?.id || "");
    if (!id) continue;

    const st = normalizeStatus(it.status);
    const cur = map.get(id);

    if (!cur || pickRank(st) > pickRank(cur.status)) {
      map.set(id, { ...it, status: st });
    }
  }

  let arr = [...map.values()];

  if (statusFilter) {
    const want = normalizeStatus(statusFilter);
    arr = arr.filter((x) => normalizeStatus(x.status) === want);
  }

  return arr;
}

// =====================================================
// ============ Hidratação de candidatos DEAL ==========
// =====================================================

/**
 * Para DEAL/SELLER_* quando um item candidate vem SEM
 * suggested/min/max, fazemos uma consulta pontual /items/:mlb
 * para tentar obter os campos e atualizar a linha.
 * Limita a 5 itens por chamada para evitar bursts.
 */
async function hydrateDealCandidateSuggestions(items) {
  const typeUp = (state.selectedCard?.type || "").toUpperCase();
  if (!["DEAL", "SELLER_CAMPAIGN", "PRICE_DISCOUNT", "DOD"].includes(typeUp))
    return;

  const targets = [];
  for (const it of items) {
    const st = String(it.status || "").toLowerCase();
    const noSug =
      !(it.suggested_discounted_price > 0) &&
      !(it.min_discounted_price > 0) &&
      !(it.max_discounted_price > 0);
    if (st === "candidate" && noSug) targets.push(it.id);
    if (targets.length >= 5) break;
  }
  if (!targets.length) return;

  for (const mlb of targets) {
    try {
      const resp = await getJSONAny(itemPromosPaths(mlb));
      const promos = Array.isArray(resp) ? resp : resp?.results ?? [];
      const match = promos.find(
        (p) => String(p?.id) === String(state.selectedCard?.id)
      );
      if (!match) continue;

      const row = state.items.find((x) => String(x.id) === String(mlb));
      if (!row) continue;

      const sug = toNum(match.suggested_discounted_price);
      const min = toNum(match.min_discounted_price);
      const max = toNum(match.max_discounted_price);

      if ((sug && sug > 0) || (min && min > 0) || (max && max > 0)) {
        if (sug && sug > 0) row.suggested_discounted_price = sug;
        if (min && min > 0) row.min_discounted_price = min;
        if (max && max > 0) row.max_discounted_price = max;

        // um refresh já atualiza todas as linhas
        await carregarItensPagina(state.paging.currentPage, true);
        break;
      }
    } catch {
      // ignora
    }
  }
}

function statusLabel(st) {
  st = normalizeStatus(st);
  if (st === "started") return "started";
  if (st === "candidate") return "candidate";
  if (st === "pending") return "programado";
  return st || "—";
}

// =====================================================
// ===================== Rebate helper =================
// =====================================================

/** Lê rebate (MELI/Seller) de diversos formatos do payload */
function pickRebate(obj) {
  const b = obj?.benefits || {};
  const meli = toNum(
    obj?.meli_percentage ?? obj?.meli_percent ?? b?.meli_percent
  );
  const seller = toNum(
    obj?.seller_percentage ?? obj?.seller_percent ?? b?.seller_percent
  );
  const type = b?.type || (meli != null ? "REBATE" : null);
  return { type, meli, seller };
}

// =====================================================
// ========= Cálculo de % de desconto por tipo =========
// =====================================================

/**
 * Calcula a % de desconto considerando o tipo de campanha
 * e as regras específicas para DEAL/SMART etc.
 */
function computeDescPct(it, benefitsGlobal) {
  const typeUp = (state.selectedCard?.type || "").toUpperCase();
  const original = toNum(it.original_price ?? it.price ?? null);
  const st = String(it.status || "").toLowerCase();

  // SMART / PRICE_MATCHING: soma MELI + Seller quando faltar % do ML
  if (["SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL"].includes(typeUp)) {
    if (original != null) {
      const rb = pickRebate(it);
      const m =
        toNum(it.meli_percentage) ??
        toNum(it.rebate_meli_percent) ??
        toNum(rb.meli) ??
        toNum(benefitsGlobal?.meli_percent);
      const s =
        toNum(it.seller_percentage) ??
        toNum(rb.seller) ??
        toNum(benefitsGlobal?.seller_percent);
      const tot = toNum((m || 0) + (s || 0));
      if (toNum(it.discount_percentage) == null && (m != null || s != null))
        return tot;
    }
    return toNum(it.discount_percentage);
  }

  // DEAL / SELLER_* : usa heurística de resolução (prioriza suggested -> min -> max)
  if (["DEAL", "SELLER_CAMPAIGN", "PRICE_DISCOUNT", "DOD"].includes(typeUp)) {
    const { pct } = resolveDealFinalAndPctFront({
      original_price: original,
      status: it.status,
      deal_price: it.deal_price ?? it.new_price,
      min_discounted_price: it.min_discounted_price,
      suggested_discounted_price: it.suggested_discounted_price,
      max_discounted_price: it.max_discounted_price,
      price: it.price,
      discount_percentage: it.discount_percentage,
    });

    const mlPct = toNum(it.discount_percentage);
    const isCandLike = st === "candidate" || st === "pending";

    if (isCandLike) return pct; // pode ficar null; melhor vazio que errado
    if (mlPct != null && mlPct > 70 && pct != null && Math.abs(mlPct - pct) > 5)
      return pct;

    return mlPct != null ? mlPct : pct;
  }

  // Fallback genérico
  const deal = toNum(it.deal_price ?? it.price ?? null);
  if (original != null && deal != null && original > 0) {
    return (1 - deal / original) * 100;
  }
  return toNum(it.discount_percentage);
}

// =====================================================
// === Resolver preço final/% para DEAL (Front-side) ===
// =====================================================

/**
 * Heurística única (espelha o back) para resolver preço final e % em DEAL/SELLER.
 */
function resolveDealFinalAndPctFront(raw) {
  const orig = Number(
    raw.original_price ?? raw.originalPrice ?? raw.price ?? 0
  );
  const st = String(raw.status || "").toLowerCase();

  const deal = Number(raw.deal_price ?? raw.new_price ?? 0);
  const minD = Number(raw.min_discounted_price ?? 0);
  const sugD = Number(raw.suggested_discounted_price ?? 0);
  const maxD = Number(raw.max_discounted_price ?? 0);
  const px = Number(raw.price ?? 0); // pode ser PREÇO FINAL ou DESCONTO em R$
  const mlPct = Number(raw.discount_percentage ?? NaN); // usado só para sanidade

  if (!orig || !isFinite(orig) || orig <= 0) {
    return { final: null, pct: null, estimated: false, source: null };
  }

  const GAP = 0.7; // valida "preço final" plausível
  const PCT_MIN = 5; // limite inferior seguro
  const PCT_MAX = 40; // limite superior seguro
  const isPlausibleFinal = (v) =>
    isFinite(v) && v > 0 && v < orig && (orig - v) / orig < GAP;
  const isPlausiblePct = (p) => isFinite(p) && p >= PCT_MIN && p <= PCT_MAX;

  const isCandLike = st === "candidate" || st === "pending";
  const noSuggestions =
    !(isFinite(sugD) && sugD > 0) &&
    !(isFinite(minD) && minD > 0) &&
    !(isFinite(maxD) && maxD > 0);

  let final = null;
  let estimated = false;
  let source = null;

  // 1) started => confiar no deal/new_price
  if (st === "started" && isPlausibleFinal(deal)) {
    final = deal;
    source = "Deal";
  }

  // 2) sugeridos primeiro
  if (!final) {
    if (isPlausibleFinal(sugD)) {
      final = sugD;
      source = "Sug";
    }
    if (!final && isPlausibleFinal(minD)) {
      final = minD;
      source = "Min";
    }
    if (!final && isPlausibleFinal(maxD)) {
      final = maxD;
      source = "Max";
    }
  }

  // 3) candidate-like sem sugestões: usar PRICE como DESCONTO EM R$
  if (!final && isCandLike && noSuggestions && isFinite(px) && px > 0) {
    const pctFromPrice = (px / orig) * 100;
    if (isPlausiblePct(pctFromPrice)) {
      const candidateFinal = orig - px;
      if (isPlausibleFinal(candidateFinal)) {
        final = candidateFinal;
        source = "PriceΔR";
        estimated = true;
      }
    }
  }

  // 4) fallback (não candidate): aceitar px como final plausível
  if (!final && !isCandLike && isFinite(px) && px > 0 && isPlausibleFinal(px)) {
    final = px;
    source = "Price";
  }

  if (!final) return { final: null, pct: null, estimated: false, source: null };

  const pct = Math.max(0, Math.min(100, ((orig - final) / orig) * 100));
  return {
    final: Number(final.toFixed(2)),
    pct: Number(pct.toFixed(2)),
    estimated,
    source,
  };
}

// =====================================================
// ========= Escolha segura de deal price (UI) =========
// =====================================================

/**
 * safeDealPrice — usa a mesma heurística do resolve* para
 * garantir que “Novo preço” mostre um valor coerente.
 */
function safeDealPrice(it, original) {
  const typeUp = (state.selectedCard?.type || "").toUpperCase();
  const isDealLike = [
    "DEAL",
    "SELLER_CAMPAIGN",
    "PRICE_DISCOUNT",
    "DOD",
  ].includes(typeUp);
  if (!isDealLike) return toNum(it.deal_price ?? it.price ?? null);

  const { final } = resolveDealFinalAndPctFront({
    original_price: toNum(original ?? it.original_price ?? it.price ?? null),
    status: it.status,
    deal_price: it.deal_price ?? it.new_price,
    min_discounted_price: it.min_discounted_price,
    suggested_discounted_price: it.suggested_discounted_price,
    max_discounted_price: it.max_discounted_price,
    price: it.price,
    discount_percentage: it.discount_percentage,
  });
  return final != null ? final : null;
}

// =====================================================
// ============== Helpers de cabeçalho Rebate ==========
// =====================================================

function hideLeadingRebateColumnIfPresent() {
  const table = getTable();
  if (!table) return;
  const ths = table.querySelectorAll("thead th");
  if (
    ths.length &&
    ths[0].textContent.trim().toLowerCase().startsWith("rebate")
  ) {
    table.classList.add("hide-leading-rebate");
  }
}
function getRebateHeaderTh() {
  const table = getTable();
  if (!table) return null;
  return [...table.querySelectorAll("thead th")].find((th) =>
    th.textContent.trim().toLowerCase().startsWith("rebate")
  );
}
function applyRebateHeaderTooltip() {
  const th = getRebateHeaderTh();
  if (!th) return;
  const b = state.promotionBenefits || state.selectedCard?.benefits || null;

  let mlp = null,
    sp = null,
    type = b?.type || state.selectedCard?.type || "—";

  if (b) {
    mlp = b.meli_percent != null ? `${b.meli_percent}%` : null;
    sp = b.seller_percent != null ? `${b.seller_percent}%` : null;
  } else if (state.items?.length) {
    const set = new Set(
      state.items
        .map(
          (x) =>
            x.meli_percentage ?? x.rebate_meli_percent ?? pickRebate(x).meli
        )
        .filter((v) => v != null)
    );
    mlp = set.size === 1 ? `${[...set][0]}%` : "varia por item";
  }

  const isRebate =
    b?.type === "REBATE" ||
    ["SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL"].includes(
      (state.selectedCard?.type || "").toUpperCase()
    );
  const rebateTag = isRebate
    ? ' <span class="badge badge-rebate">REBATE</span>'
    : "";

  th.innerHTML = `Rebate <span class="tip" title="Tipo: ${type}\nMELI: ${
    mlp ?? "—"
  }\nSeller: ${sp ?? "—"}">ⓘ</span>${rebateTag}`;
}

// =====================================================
// ================ Eventos básicos da UI ==============
// =====================================================

document.addEventListener("click", async (ev) => {
  const t = ev.target;

  if (t.closest?.("#btnFiltrarItem")) {
    ev.preventDefault();
    const mlb = ($("#mlbFilter")?.value || "").trim().toUpperCase();
    state.mlbFilter = mlb;
    if (!mlb) {
      state.cardsFilteredIds = null;
      renderCards();
      return;
    }
    await filtrarCardsPorMLB(mlb);
    atualizarFaixaSelecaoCampanha();
    return;
  }

  if (t.closest?.("#btnLimparItem")) {
    ev.preventDefault();
    state.mlbFilter = "";
    state.cardsFilteredIds = null;
    const input = $("#mlbFilter");
    if (input) input.value = "";
    renderCards();
    atualizarFaixaSelecaoCampanha();
    return;
  }

  if (t.closest?.("#btnMaxDescTable")) {
    ev.preventDefault();
    const v = $("#maxDescTableInput")?.value?.trim();
    state.maxDesc = v === "" || v == null ? null : Number(v);
    if (state.selectedCard) await carregarItensPagina(1, true);
    atualizarFaixaSelecaoCampanha();
    return;
  }

  if (t.closest?.("#btnLimparMaxDescTable")) {
    ev.preventDefault();
    state.maxDesc = null;
    const input = $("#maxDescTableInput");
    if (input) input.value = "";
    if (state.selectedCard) await carregarItensPagina(1, true);
    atualizarFaixaSelecaoCampanha();
    return;
  }

  // Esses dois IDs são opcionais, mantidos por compatibilidade
  if (t.closest?.("#btnRemoverTodos")) {
    ev.preventDefault();
    await removerEmMassaSelecionados().catch((err) => console.error(err));
    atualizarFaixaSelecaoCampanha();
    return;
  }

  if (t.closest?.("#btnAplicarTodos")) {
    ev.preventDefault();
    await aplicarTodosFiltrados().catch((err) => console.error(err));
    atualizarFaixaSelecaoCampanha();
    return;
  }
});

document.addEventListener("change", async (ev) => {
  const r = ev.target;
  if (r.name === "filtro") {
    state.filtroParticipacao = r.value || "all";
    if (state.selectedCard) await carregarItensPagina(1, true);
    atualizarFaixaSelecaoCampanha();
  }
});

document.addEventListener("keydown", async (ev) => {
  if (ev.key === "Enter" && ev.target?.id === "mlbFilter") {
    ev.preventDefault();
    const mlb = ev.target.value.trim().toUpperCase();
    state.mlbFilter = mlb;
    if (!mlb) {
      state.cardsFilteredIds = null;
      renderCards();
      return;
    }
    await filtrarCardsPorMLB(mlb);
    atualizarFaixaSelecaoCampanha();
  }
});

/* ======================== Busca por MLB (cards do item) ======================== */

const ITEM_PROMO_TYPES = new Set([
  "SMART",
  "MARKETPLACE_CAMPAIGN",
  "DEAL",
  "PRICE_MATCHING",
  "PRICE_MATCHING_MELI_ALL",
  "SELLER_CAMPAIGN",
  "PRICE_DISCOUNT",
]);

const itemPromosPaths = (mlb) => [
  `/api/promocoes/items/${encodeURIComponent(mlb)}`,
  `/api/promotions/items/${encodeURIComponent(mlb)}`,
  `/api/promocao/items/${encodeURIComponent(mlb)}`,
];

async function buscarCardsDoItem(mlb) {
  for (const p of itemPromosPaths(mlb)) {
    try {
      const r = await fetch(p, { credentials: "same-origin" });
      if (!r.ok) continue;
      const arr = await r.json();

      const cards = extractList(arr)
        .filter(
          (c) =>
            c &&
            (c.id || c.name) &&
            ITEM_PROMO_TYPES.has(String(c.type || "").toUpperCase())
        )
        .map((c) => ({
          id: c.id,
          type: String(c.type || "").toUpperCase(),
          name: c.name || c.id || "Campanha",
          status: c.status,
          start_date: c.start_date,
          finish_date: c.finish_date,
          benefits: c.benefits || null,
        }));

      return cards;
    } catch {
      /* tenta próxima rota */
    }
  }
  return [];
}

/* ======================== Tabs por tipo (Cards) ======================== */

const TAB_POLICY = {
  hideZeros: true,
  removeTypes: new Set([
    "DOD",
    "MARKETPLACE_CAMPAIGN",
    "PRICE_MATCHING_MELI_ALL",
  ]),
};

const TYPE_LABELS = {
  ALL: "Todas",
  SMART: "Smart",
  DEAL: "Deal",
  SELLER_CAMPAIGN: "Seller",
  PRICE_DISCOUNT: "Price Discount",
  OTHER: "Outros",
};

function normalizeCardTypeForTabs(type) {
  const up = String(type || "").toUpperCase();

  // Smart tab = SMART + PRICE_MATCHING
  if (up === "PRICE_MATCHING") return "SMART";

  // você já decidiu que PM(ML) some, e Marketplace/DOD somem também
  // (se você já filtrou no carregarCards, ótimo; aqui deixo seguro)
  if (up === "PRICE_MATCHING_MELI_ALL") return "REMOVED";
  if (up === "MARKETPLACE_CAMPAIGN") return "REMOVED";
  if (up === "DOD") return "REMOVED";

  // Tabs dedicadas que você quer manter
  if (up === "SMART") return "SMART";
  if (up === "DEAL") return "DEAL";
  if (up === "SELLER_CAMPAIGN") return "SELLER_CAMPAIGN";
  if (up === "PRICE_DISCOUNT") return "PRICE_DISCOUNT";

  // qualquer outro tipo vira "OTHER" (opcional)
  return "OTHER";
}

function getCardsByActiveType(list) {
  const arr = Array.isArray(list) ? list : [];
  const active = String(state.activeTypeTab || "ALL").toUpperCase();

  if (active === "ALL") return arr;

  // Filtra usando a mesma normalização
  return arr.filter((card) => {
    const t = normalizeCardTypeForTabs(card?.type);

    // segurança: se cair em "REMOVED", não exibe nunca
    if (t === "REMOVED") return false;

    // se existir tab OTHER, só entra o que não for tab principal
    if (active === "OTHER") return t === "OTHER";

    // default: match direto
    return t === active;
  });
}

function updateTabsCounts(listAll) {
  const list = Array.isArray(listAll) ? listAll : [];

  const counts = {
    ALL: list.length,
    SMART: 0,
    DEAL: 0,
    SELLER_CAMPAIGN: 0,
    PRICE_DISCOUNT: 0,
    OTHER: 0,
  };

  for (const c of list) {
    const ty = normalizeCardTypeForTabs(c?.type);
    if (ty === "REMOVED") continue;
    counts[ty] = (counts[ty] || 0) + 1;
  }

  document.querySelectorAll("[data-count]").forEach((el) => {
    const k = String(el.getAttribute("data-count") || "").toUpperCase();
    if (!k) return;
    if (counts[k] == null) return;
    el.textContent = String(counts[k]);
  });

  const label = document.getElementById("promoTabsLabel");
  const meta = document.getElementById("promoTabsMeta");
  if (label) {
    label.textContent = TYPE_LABELS[state.activeTypeTab] || state.activeTypeTab;
  }
  if (meta) {
    const showing = getCardsByActiveType(list).length;
    meta.textContent = `${showing} de ${list.length} campanhas`;
  }
}

function setupTypeTabs() {
  const row = document.getElementById("promoTypeTabs");
  if (!row) return;

  // evita múltiplos binds se carregarCards chamar mais de uma vez
  if (row.dataset.bound === "1") return;
  row.dataset.bound = "1";

  row.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("button[data-type]");
    if (!btn) return;

    // Se estiver oculto/desabilitado, ignora
    if (btn.classList.contains("is-hidden") || btn.disabled) return;

    const type = String(btn.dataset.type || "ALL").toUpperCase();

    // Agora só aceitamos ALL | SMART | DEAL | SELLER_CAMPAIGN | PRICE_DISCOUNT | OTHER
    state.activeTypeTab = type;

    row.querySelectorAll("button[data-type]").forEach((b) => {
      const isOn = String(b.dataset.type || "").toUpperCase() === type;
      b.classList.toggle("active", isOn);
      b.setAttribute("aria-selected", isOn ? "true" : "false");
    });

    renderCards();
    atualizarFaixaSelecaoCampanha();
  });
}

/* ======================== Cards ======================== */

// --- coloque extractList fora do carregarCards (ideal) ou mantenha aqui ---
function extractList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  if (payload.data) {
    const v = payload.data;
    if (Array.isArray(v)) return v;
    if (Array.isArray(v.results)) return v.results;
    if (Array.isArray(v.users)) return v.users;
    if (Array.isArray(v.campaigns)) return v.campaigns;
    if (Array.isArray(v.items)) return v.items;
  }

  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.campaigns)) return payload.campaigns;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;

  for (const k of Object.keys(payload)) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

async function carregarCards() {
  const $cards = elCards();
  if (!$cards) return;

  $cards.classList.add("cards-grid");
  $cards.innerHTML = `<div class="card"><h3>Carregando promoções…</h3><div class="muted">Aguarde</div></div>`;

  function applyTabsVisibility(listAllFilteredByMLB) {
    const counts = {
      ALL: listAllFilteredByMLB.length,
      SMART: 0,
      DEAL: 0,
      SELLER_CAMPAIGN: 0,
      PRICE_DISCOUNT: 0,
      OTHER: 0,
    };

    for (const c of listAllFilteredByMLB) {
      const ty = normalizeCardTypeForTabs(c.type);
      if (ty === "REMOVED") continue;
      counts[ty] = (counts[ty] || 0) + 1;
    }

    document.querySelectorAll("[data-count]").forEach((el) => {
      const k = String(el.getAttribute("data-count") || "").toUpperCase();
      if (!k) return;
      if (counts[k] == null) return;
      el.textContent = String(counts[k]);
    });

    const row = document.getElementById("promoTypeTabs");
    if (!row) return;

    row.querySelectorAll("button[data-type]").forEach((btn) => {
      const type = String(btn.dataset.type || "").toUpperCase();

      const isRemoved =
        TAB_POLICY.removeTypes.has(type) ||
        type === "DOD" ||
        type === "MARKETPLACE_CAMPAIGN" ||
        type === "PRICE_MATCHING_MELI_ALL";

      if (isRemoved) {
        btn.classList.add("is-hidden");
        btn.style.display = "none";
        return;
      }

      const allowed = new Set([
        "ALL",
        "SMART",
        "DEAL",
        "SELLER_CAMPAIGN",
        "PRICE_DISCOUNT",
        "OTHER",
      ]);

      if (!allowed.has(type)) {
        btn.classList.add("is-hidden");
        btn.style.display = "none";
        return;
      }

      if (TAB_POLICY.hideZeros && type !== "ALL") {
        const n = counts[type] ?? 0;
        btn.style.display = n > 0 ? "" : "none";
      } else {
        btn.style.display = "";
      }

      btn.classList.remove("is-hidden");
    });

    const activeBtn = row.querySelector(
      `button[data-type="${state.activeTypeTab}"]`
    );
    const activeHidden =
      !activeBtn || activeBtn.style.display === "none" || activeBtn.disabled;

    if (activeHidden) {
      state.activeTypeTab = "ALL";
      row.querySelectorAll("button[data-type]").forEach((b) => {
        const isOn = String(b.dataset.type || "").toUpperCase() === "ALL";
        b.classList.toggle("active", isOn);
        b.setAttribute("aria-selected", isOn ? "true" : "false");
      });
    }
  }

  try {
    setupTypeTabs();

    const tryVariants = [
      (p) => `${p}?status=all`,
      (p) => `${p}?status=started,scheduled`,
      (p) => `${p}?status=started,pending`,
      (p) => `${p}?status=active,scheduled`,
      (p) => p,
    ];

    let data = null;
    let buildOk = null;

    for (const build of tryVariants) {
      try {
        data = await getJSONAny(usersPaths().map(build));
        const first = extractList(data);
        if (first.length) {
          buildOk = build;
          break;
        }
      } catch {
        // tenta a próxima variação
      }
    }

    if (!data) throw new Error("Sem resposta do /users");

    let all = extractList(data);

    const paging = data?.paging || null;
    const total = Number(paging?.total || all.length || 0);
    const limit = Number(paging?.limit || 0);
    let offset = Number(paging?.offset || 0);

    // ✅ Paginação preservando o mesmo “build” que funcionou (status=...)
    if (total > 0 && limit > 0 && all.length < total) {
      const maxLoops = 200;
      for (let i = 0; i < maxLoops; i++) {
        offset += limit;
        if (offset >= total) break;

        const pageData = await getJSONAny(
          usersPaths().map((p) => {
            const base = buildOk ? buildOk(p) : p;
            const join = base.includes("?") ? "&" : "?";
            return `${base}${join}limit=${encodeURIComponent(
              limit
            )}&offset=${encodeURIComponent(offset)}`;
          })
        );

        const pageItems = extractList(pageData);
        if (!pageItems.length) break;

        all.push(...pageItems);
        if (pageItems.length < limit) break;
        if (all.length >= total) break;
      }
    }

    const seen = new Set();
    all = all.filter((c) => {
      const id = String(c?.id || "");
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    all = all.filter((c) => normalizeCardTypeForTabs(c.type) !== "REMOVED");

    state.cards = all;
    console.log(`ℹ️ ${state.cards.length} cards carregados (total)`);

    if (state.mlbFilter) {
      await filtrarCardsPorMLB(state.mlbFilter);
    }

    const baseList = state.cardsFilteredIds
      ? state.cards.filter((c) => state.cardsFilteredIds.has(c.id))
      : state.cards;

    applyTabsVisibility(baseList);

    renderCards();
  } catch (e) {
    const authMsg =
      e?.cause?.status === 401 || e?.cause?.status === 403
        ? "Sua sessão com o Mercado Livre expirou ou não é de usuário. Clique em “Trocar Conta” e reconecte."
        : "Não foi possível carregar promoções (ver console).";

    console.error("[/users] erro ao carregar cards:", e, e?.cause);
    $cards.innerHTML = `<div class="card"><h3>Falha</h3><pre class="muted">${esc(
      authMsg
    )}</pre></div>`;
  } finally {
    atualizarFaixaSelecaoCampanha();
  }
}

function renderCards() {
  const $cards = elCards();
  $cards.classList.add("cards-grid");

  // 1) base: filtro MLB (se existir)
  const baseList = state.cardsFilteredIds
    ? state.cards.filter((c) => state.cardsFilteredIds.has(c.id))
    : state.cards;

  // 2) contadores sempre refletem o “universo atual” (já filtrado por MLB)
  updateTabsCounts(baseList);

  // 3) aplica filtro por aba (tipo)
  const list = getCardsByActiveType(baseList);

  if (!list.length) {
    const msg = state.mlbFilter
      ? `Nenhuma campanha (${
          TYPE_LABELS[state.activeTypeTab] || state.activeTypeTab
        }) oferece promoção para o item ${esc(state.mlbFilter)}.`
      : `Nenhuma promoção em ${
          TYPE_LABELS[state.activeTypeTab] || state.activeTypeTab
        }.`;
    $cards.innerHTML = `<div class="card"><h3>${msg}</h3></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((c) => {
    const div = document.createElement("div");
    div.className = "card";
    div.tabIndex = 0;

    const status = (c.status || "").toLowerCase();
    const pill =
      status === "started"
        ? '<span class="pill">started</span>'
        : `<span class="pill muted">${esc(c.status || "")}</span>`;
    const fini = c.finish_date
      ? new Date(c.finish_date).toLocaleDateString("pt-BR")
      : "";

    const benefits = c.benefits || null;
    const benefitsStr = benefits
      ? `Rebate MELI: ${benefits.meli_percent ?? "—"}% • Seller: ${
          benefits.seller_percent ?? "—"
        }%`
      : "";

    const isRebate =
      benefits?.type === "REBATE" ||
      ["SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL"].includes(
        (c.type || "").toUpperCase()
      );
    const rebateTag = isRebate
      ? '<span class="badge badge-rebate">REBATE</span>'
      : "";

    div.innerHTML = `<h3>${esc(c.name || c.id || "Campanha")} ${rebateTag}</h3>
      <div class="muted">${esc(c.type || "")} ${pill}</div>
      <div class="muted">${fini ? "Até " + fini : ""}</div>
      ${
        benefitsStr
          ? `<div class="muted" style="margin-top:4px">${benefitsStr}</div>`
          : ""
      }`;

    div.addEventListener("click", () => selecionarCard(c));
    frag.appendChild(div);
  });

  $cards.innerHTML = "";
  $cards.appendChild(frag);
  destacarCardSelecionado();
}

function destacarCardSelecionado() {
  const $cards = elCards();
  $cards
    .querySelectorAll("div.card")
    .forEach((n) => n.classList.remove("card--active"));

  const baseList = state.cardsFilteredIds
    ? state.cards.filter((c) => state.cardsFilteredIds.has(c.id))
    : state.cards;

  const list = getCardsByActiveType(baseList);

  const idx = list.findIndex((c) => c.id === state.selectedCard?.id);
  if (idx >= 0 && $cards.children[idx])
    $cards.children[idx].classList.add("card--active");
}

// Busca por MLB: filtra cards que possuem promoção para o item
async function filtrarCardsPorMLB(mlb) {
  try {
    const resp = await getJSONAny([
      `/api/promocoes/items/${encodeURIComponent(mlb)}/promotions`,
      `/api/promocao/items/${encodeURIComponent(mlb)}/promotions`,
      `/api/promotions/items/${encodeURIComponent(mlb)}/promotions`,
      `/api/promocoes/items/${encodeURIComponent(mlb)}`,
      `/api/promocao/items/${encodeURIComponent(mlb)}`,
      `/api/promotions/items/${encodeURIComponent(mlb)}`,
    ]);

    const promos = extractList(resp);

    const idsDoItem = new Set(promos.filter((p) => p && p.id).map((p) => p.id));

    state.cardsFilteredIds = new Set(
      state.cards.filter((c) => idsDoItem.has(c.id)).map((c) => c.id)
    );
    renderCards();

    updateTabsCounts(
      state.cards.filter((c) => state.cardsFilteredIds.has(c.id))
    );

    const list = state.cards.filter((c) => state.cardsFilteredIds.has(c.id));
    if (list.length === 1) selecionarCard(list[0]);
  } catch (e) {
    console.warn("Falha ao buscar promoções do item (todas as rotas).", e);
    state.cardsFilteredIds = null;
    renderCards();
  }
}

/* ======================== Seleção de card / Tabela ======================== */

async function selecionarCard(card) {
  state.selectedCard = {
    id: card.id,
    type: (card.type || "").toUpperCase(),
    name: card.name || card.id,
    benefits: card.benefits || null,
  };
  state.promotionBenefits = null;
  state.paging = {
    total: 0,
    limit: PAGE_SIZE,
    tokensByPage: { 1: null },
    currentPage: 1,
    lastPageKnown: 1,
  };
  destacarCardSelecionado();
  hideLeadingRebateColumnIfPresent();
  applyRebateHeaderTooltip();
  updateSelectedCampaignName();

  // Informa contexto ao módulo bulk (se existir)
  if (window.PromoBulk) {
    window.PromoBulk.setContext({
      promotion_id: state.selectedCard.id,
      promotion_type: state.selectedCard.type,
      filtroParticipacao: state.filtroParticipacao,
      maxDesc: state.maxDesc,
      mlbFilter: state.mlbFilter,
    });
  }

  if (state.mlbFilter) {
    await carregarSomenteMLBSelecionado(); // modo busca unitária
  } else {
    await carregarItensPagina(1, true);
  }
}

function qsBuild(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
function filtroToStatusParam() {
  const v = String(state.filtroParticipacao || "all").toLowerCase();

  // Participantes
  if (["yes", "participantes", "participante", "started"].includes(v)) {
    return "started";
  }

  // Não participantes
  if (
    [
      "non",
      "nao",
      "não",
      "nao_participantes",
      "nao-participantes",
      "candidate",
    ].includes(v)
  ) {
    return "candidate";
  }

  // Programados / Agendados
  if (
    ["prog", "programados", "agendados", "pending", "scheduled"].includes(v)
  ) {
    return "pending";
  }

  return "";
}

async function carregarItensPagina(pageNumber, reset = false) {
  const $body = elTbody();
  if (!state.selectedCard) {
    $body.innerHTML = `<tr><td colspan="12" class="muted">Clique em um card de promoção.</td></tr>`;
    return;
  }
  if (reset) {
    state.paging.tokensByPage = { 1: null };
    state.paging.currentPage = 1;
    state.paging.lastPageKnown = 1;
    $body.innerHTML = `<tr><td colspan="12" class="muted">Carregando itens…</td></tr>`;
  }

  state.loading = true;
  renderPaginacao();

  const targetPage = Math.max(1, pageNumber | 0);
  let haveToken = state.paging.tokensByPage[targetPage] !== undefined;

  const statusParam = filtroToStatusParam();

  try {
    while (!haveToken) {
      const prev = state.paging.lastPageKnown;
      const prevToken = state.paging.tokensByPage[prev] ?? null;

      const qs = qsBuild({
        limit: PAGE_SIZE,
        ...(statusParam ? { status: statusParam } : {}),
        ...(prevToken ? { search_after: prevToken } : {}),
      });

      const data = await getJSONAny(
        itemsPaths(state.selectedCard.id, state.selectedCard.type, qs)
      );

      const nextToken = data?.paging?.searchAfter || null;
      const total = data?.paging?.total ?? 0;
      if (data?.promotion_benefits)
        state.promotionBenefits = data.promotion_benefits;

      state.paging.total = total;
      state.paging.tokensByPage[prev + 1] = nextToken;
      state.paging.lastPageKnown = prev + 1;

      haveToken = state.paging.tokensByPage[targetPage] !== undefined;
      if (!nextToken) break;
    }

    const token = state.paging.tokensByPage[targetPage] ?? null;
    const qs = qsBuild({
      limit: PAGE_SIZE,
      ...(statusParam ? { status: statusParam } : {}),
      ...(token ? { search_after: token } : {}),
    });

    const data = await getJSONAny(
      itemsPaths(state.selectedCard.id, state.selectedCard.type, qs)
    );
    if (data?.promotion_benefits)
      state.promotionBenefits = data.promotion_benefits;

    let items = Array.isArray(data.results) ? data.results : [];

    items = items.map((x) => ({ ...x, status: normalizeStatus(x.status) }));
    items = dedupeByMLB(items, statusParam || "");

    if (state.mlbFilter) {
      const mlbUp = state.mlbFilter.toUpperCase();
      items = items.filter((x) => (x.id || "").toUpperCase() === mlbUp);
    }

    if (state.maxDesc != null) {
      items = items.filter((x) => {
        const descPct = computeDescPct(
          x,
          state.promotionBenefits || state.selectedCard?.benefits || null
        );
        return descPct == null
          ? false
          : Number(descPct) <= Number(state.maxDesc);
      });
    }

    state.items = items;
    state.paging.total = data?.paging?.total ?? state.paging.total;
    state.paging.currentPage = targetPage;

    renderTabela(state.items);
    renderPaginacao();
    applyRebateHeaderTooltip();

    // 🔄 Hidratar candidatos secos (busca por item p/ trazer suggested/min/max)
    await hydrateDealCandidateSuggestions(state.items);
  } catch (e) {
    const isAuth = e?.cause?.status === 401 || e?.cause?.status === 403;
    const authMsg = isAuth
      ? "Sua sessão com o Mercado Livre expirou ou não é de usuário. Clique em “Trocar Conta” e reconecte."
      : "Falha ao listar itens (ver console).";

    console.error("[carregarItensPagina] erro:", e, e?.cause);

    const code = e?.cause?.status ? ` (HTTP ${e.cause.status})` : "";
    const snippet = e?.cause?.body ? String(e.cause?.body).slice(0, 180) : "";
    $body.innerHTML =
      `<tr><td colspan="12" class="muted">${esc(authMsg + code)}</td></tr>` +
      (snippet
        ? `<tr><td colspan="12"><pre class="muted" style="white-space:pre-wrap">${esc(
            snippet
          )}</pre></td></tr>`
        : "");
  } finally {
    state.loading = false;
    renderPaginacao();
    atualizarFaixaSelecaoCampanha();
  }
}

function renderTabela(items) {
  const $body = elTbody();
  if (!items?.length) {
    $body.innerHTML = `<tr><td colspan="12" class="muted">Nenhum item para esta página.</td></tr>`;
    return;
  }

  const benefitsGlobal =
    state.promotionBenefits || state.selectedCard?.benefits || null;

  const typeUp = (state.selectedCard?.type || "").toUpperCase();
  const isSmartLike = [
    "SMART",
    "PRICE_MATCHING",
    "PRICE_MATCHING_MELI_ALL",
  ].includes(typeUp);
  const isDealLike = [
    "DEAL",
    "SELLER_CAMPAIGN",
    "PRICE_DISCOUNT",
    "DOD",
  ].includes(typeUp);

  const rows = items
    .map((it) => {
      const mlb = it.id || "";
      const tit = it.title || "—";
      const est = it.available_quantity ?? it.stock ?? "—";
      const sku = it.seller_custom_field ?? it.sku ?? "—";
      const original = toNum(it.original_price ?? it.price ?? null);

      // Resolver base e % com o helper (traz flag estimated)
      const res = resolveDealFinalAndPctFront({
        original_price: original,
        status: it.status,
        deal_price: it.deal_price ?? it.new_price,
        min_discounted_price: it.min_discounted_price,
        suggested_discounted_price: it.suggested_discounted_price,
        max_discounted_price: it.max_discounted_price,
        price: it.price,
        discount_percentage: it.discount_percentage,
      });

      let basePrice = res.final ?? safeDealPrice(it, original);
      let descPct = toNum(it.discount_percentage);

      if (isSmartLike && original != null) {
        const rb = pickRebate(it);
        const m =
          toNum(it.meli_percentage) ??
          toNum(it.rebate_meli_percent) ??
          toNum(rb.meli) ??
          toNum(benefitsGlobal?.meli_percent);

        const s =
          toNum(it.seller_percentage) ??
          toNum(rb.seller) ??
          toNum(benefitsGlobal?.seller_percent);

        const tot = toNum((m || 0) + (s || 0));
        if (descPct == null && (m != null || s != null)) descPct = tot;

        if (basePrice == null && descPct != null) {
          basePrice = original * (1 - descPct / 100);
        }

        // compat visual
        if (it.rebate_meli_percent == null && m != null)
          it.rebate_meli_percent = m;
      }

      if (isDealLike) {
        if (res.pct != null) descPct = res.pct;

        // correção de discrepância absurda
        if (
          descPct != null &&
          descPct > 70 &&
          basePrice != null &&
          original > 0
        ) {
          const recompute = (1 - basePrice / original) * 100;
          if (Math.abs(recompute - descPct) > 5) descPct = recompute;
        }
      } else if (
        descPct == null &&
        original != null &&
        basePrice != null &&
        original > 0
      ) {
        descPct = (1 - basePrice / original) * 100;
      }

      const precoAtual = original != null ? fmtMoeda(original) : "—";

      // “Preço final” (campo do payload) — mantém como você tinha
      const precoFinal =
        toNum(it.deal_price) != null ? fmtMoeda(toNum(it.deal_price)) : "—";

      // “Novo preço” (heurístico)
      const novoPreco =
        basePrice != null
          ? res.estimated
            ? `≈ ${fmtMoeda(basePrice)}`
            : fmtMoeda(basePrice)
          : "—";

      const rb = pickRebate(it);
      const meliPct =
        it.meli_percentage != null
          ? Number(it.meli_percentage)
          : it.rebate_meli_percent != null
          ? Number(it.rebate_meli_percent)
          : rb.meli != null
          ? Number(rb.meli)
          : benefitsGlobal?.meli_percent != null
          ? Number(benefitsGlobal.meli_percent)
          : null;

      const hasRebate =
        isSmartLike &&
        (meliPct != null || rb.type === "REBATE" || rb.meli != null);

      const rebateCell = hasRebate
        ? `${
            meliPct != null ? fmtPerc(meliPct, 2) + " " : ""
          }<span class="pill green">REBATE</span>`
        : "—";

      const status = statusLabel(it.status);

      // ✅ IMPORTANTE: onclick seguro (não usa esc(), usa jsStr())
      return `<tr>
        <td style="text-align:center"><input type="checkbox" data-mlb="${esc(
          mlb
        )}"></td>
        <td>${esc(mlb)}</td>
        <td>${esc(tit)}</td>
        <td>${esc(est)}</td>
        <td>${esc(sku)}</td>
        <td>${precoAtual}</td>
        <td>${descPct != null ? fmtPerc(descPct, 2) : "—"}</td>
        <td>${precoFinal}</td>
        <td>${rebateCell}</td>
        <td>${novoPreco}</td>
        <td>${esc(status)}</td>
        <td style="text-align:right">
          <button class="btn primary" onclick="aplicarUnico(${jsStr(
            mlb
          )})">Aplicar</button>
          <button class="btn ghost" onclick="removerUnicoDaCampanha(${jsStr(
            mlb
          )})">Remover</button>
        </td>
      </tr>`;
    })
    .join("");

  $body.innerHTML = rows;

  if (window.PromoBulk && state.selectedCard) {
    window.PromoBulk.setContext({
      promotion_id: state.selectedCard.id,
      promotion_type: state.selectedCard.type,
      filtroParticipacao: state.filtroParticipacao,
      maxDesc: state.maxDesc,
      mlbFilter: state.mlbFilter,
    });
  }
}

function updateSelectedCampaignName() {
  const el = document.getElementById("campName");
  if (!el) return;
  if (state.selectedCard) {
    const name = state.selectedCard.name || state.selectedCard.id;
    el.textContent = `Campanha: “${name}”`;
    el.title = name;
  } else {
    el.textContent = "Campanha: — selecione um card —";
    el.title = "— selecione um card —";
  }
}

function renderPaginacao() {
  const $pag = elPag();
  $pag.innerHTML = "";
  if (state.loading) return;

  const total = Number(state.paging.total || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur = state.paging.currentPage;

  const MAX_BTNS = 9;
  let start = Math.max(1, cur - Math.floor(MAX_BTNS / 2));
  let end = Math.min(pages, start + MAX_BTNS - 1);
  start = Math.max(1, end - MAX_BTNS + 1);

  const btn = (p, label = String(p), disabled = false, active = false) =>
    `<button class="page-btn${active ? " active" : ""}" ${
      disabled ? "disabled" : ""
    } onclick="goPage(${p})">${label}</button>`;

  let html = "";
  html += btn(Math.max(1, cur - 1), "‹", cur === 1);
  if (start > 1) {
    html += btn(1, "1", false, cur === 1);
    if (start > 2) html += `<span class="muted" style="padding:0 6px">…</span>`;
  }
  for (let p = start; p <= end; p++)
    html += btn(p, String(p), false, p === cur);
  if (end < pages) {
    if (end < pages - 1)
      html += `<span class="muted" style="padding:0 6px">…</span>`;
    html += btn(pages, String(pages), false, cur === pages);
  }
  html += btn(Math.min(pages, cur + 1), "›", cur === pages);

  $pag.innerHTML = html;
}

/* ======================== Busca unitária por MLB ======================== */

async function montarItemRapido(mlb) {
  // 1) Busca todas as promoções do item e localiza a campanha selecionada
  const resp = await getJSONAny([
    `/api/promocoes/items/${encodeURIComponent(mlb)}/promotions`,
    `/api/promocao/items/${encodeURIComponent(mlb)}/promotions`,
    `/api/promotions/items/${encodeURIComponent(mlb)}/promotions`,
    `/api/promocoes/items/${encodeURIComponent(mlb)}`,
    `/api/promocao/items/${encodeURIComponent(mlb)}`,
    `/api/promotions/items/${encodeURIComponent(mlb)}`,
  ]);

  const promos = extractList(resp);

  const sel = state.selectedCard;
  const match = promos.find((p) => p && p.id === sel?.id) || null;
  if (!match) return null;

  // 2) Tenta enriquecer com dados básicos do item
  let b = null;
  try {
    b = await getJSONAny([
      `/api/items/brief?ids=${encodeURIComponent(mlb)}`,
      `/api/items/basic?ids=${encodeURIComponent(mlb)}`,
    ]);
    if (Array.isArray(b)) {
      const hit = b.find((x) => x.id === mlb || x?.body?.id === mlb);
      b = hit?.body || hit || null;
    }
  } catch (_) {
    /* opcional */
  }

  // 3) Seleciona uma oferta relevante (se existir)
  const offer =
    Array.isArray(match.offers) && match.offers[0] ? match.offers[0] : {};

  // 4) Monta estrutura base para cálculo
  const tmp = {
    id: mlb,
    title: b?.title || match?.title || offer?.title || "—",
    available_quantity:
      b?.available_quantity ??
      offer?.available_quantity ??
      match?.available_quantity ??
      null,
    seller_custom_field:
      b?.seller_custom_field ??
      offer?.seller_custom_field ??
      match?.seller_custom_field ??
      null,

    // preços candidatos
    original_price: toNum(
      match.original_price ?? offer.original_price ?? b?.price ?? null
    ),
    deal_price: toNum(
      match.price ?? match.new_price ?? offer.new_price ?? offer.price ?? null
    ),
    // desconto reportado (quando vier)
    discount_percentage: toNum(
      match.discount_percentage ?? offer.discount_percentage ?? null
    ),

    // campos candidatos para DEAL/SELLER
    min_discounted_price: toNum(
      match.min_discounted_price ?? offer.min_discounted_price ?? null
    ),
    suggested_discounted_price: toNum(
      match.suggested_discounted_price ??
        offer.suggested_discounted_price ??
        null
    ),
    max_discounted_price: toNum(
      match.max_discounted_price ?? offer.max_discounted_price ?? null
    ),

    // rebate/percentuais
    meli_percentage: toNum(
      match.meli_percentage ?? offer.meli_percentage ?? null
    ),
    seller_percentage: toNum(
      match.seller_percentage ?? offer.seller_percentage ?? null
    ),

    // status do item nesta campanha
    status: normalizeStatus(offer?.status || match.status || "—"),

    // benefits brutos (se houver)
    benefits: match.benefits || offer.benefits || null,
  };

  // Se não tem available_quantity no brief, tenta um fallback neutro
  if (
    tmp.available_quantity == null &&
    typeof b?.available_quantity !== "number"
  ) {
    tmp.available_quantity = "—";
  }
  if (!tmp.seller_custom_field && b?.seller_custom_field == null) {
    tmp.seller_custom_field = "—";
  }

  // 5) Calcula % de desconto usando a mesma regra da tabela (corrige DEAL/SELLER)
  const benefitsGlobal =
    state.promotionBenefits || state.selectedCard?.benefits || null;
  let descPct = computeDescPct(tmp, benefitsGlobal);

  // 6) Se não tem deal_price mas já temos desconto e original, calculamos o deal
  if (tmp.deal_price == null && tmp.original_price != null && descPct != null) {
    tmp.deal_price = round2(tmp.original_price * (1 - descPct / 100));
  }

  // 7) Meli rebate visível (para célula REBATE)
  let rbMeli = tmp.meli_percentage;
  if (rbMeli == null) {
    const rb = pickRebate(tmp);
    rbMeli = toNum(rb.meli ?? benefitsGlobal?.meli_percent ?? null);
  }

  // 8) Retorna no formato esperado pela UI/tabela
  return {
    id: mlb,
    title: tmp.title || "—",
    available_quantity: tmp.available_quantity ?? "—",
    seller_custom_field: tmp.seller_custom_field ?? "—",
    original_price: tmp.original_price ?? null,
    deal_price: tmp.deal_price ?? null,
    discount_percentage: descPct ?? null,
    meli_percentage: tmp.meli_percentage ?? null,
    rebate_meli_percent: rbMeli != null ? Number(rbMeli) : null,
    status: tmp.status || "—",
    benefits: tmp.benefits || undefined,
  };
}

async function buscarItemNaCampanha(mlb) {
  const mlbUp = (mlb || "").toUpperCase();
  let token = null;
  const statusFlag = filtroToStatusParam();
  const shouldSendStatus = !!(statusFlag && statusFlag !== "__pending__");

  for (let i = 0; i < 200; i++) {
    const qsObj = { limit: 50 };
    if (shouldSendStatus) qsObj.status = statusFlag;
    if (token) qsObj.search_after = token;

    const data = await getJSONAny(
      itemsPaths(state.selectedCard.id, state.selectedCard.type, qsBuild(qsObj))
    );
    if (data?.promotion_benefits)
      state.promotionBenefits = data.promotion_benefits;

    let items = Array.isArray(data.results) ? data.results : [];
    items = items.map((x) => ({ ...x, status: normalizeStatus(x.status) }));
    if (statusFlag === "__pending__") {
      items = items.filter((x) => normalizeStatus(x.status) === "pending");
    }

    const found = items.find((it) => (it.id || "").toUpperCase() === mlbUp);
    if (found) return found;

    token = data?.paging?.searchAfter || null;
    if (!token) break;
  }
  return null;
}
/* ======================== Offer/Candidate helpers ======================== */

function isCandidateId(id) {
  return /^CANDIDATE-[A-Z0-9-]+$/i.test(String(id || ""));
}

function getAllOfferLikeIds(it) {
  const set = new Set();
  const add = (v) => {
    if (v) set.add(String(v));
  };

  add(it?.offer_id);
  add(it?.candidate_id);
  add(it?.offer_candidate_id);
  add(it?.candidate?.id);

  if (Array.isArray(it?.offers)) {
    for (const o of it.offers) {
      add(o?.id);
      add(o?.candidate_id);
    }
  }
  return [...set];
}

function extractCandidateIdFromItem(it) {
  if (isCandidateId(it?.candidate_id)) return String(it.candidate_id);
  if (Array.isArray(it?.offers)) {
    const cand = it.offers.find(
      (o) => isCandidateId(o?.id) || isCandidateId(o?.candidate_id)
    );
    if (cand) return String(cand.candidate_id || cand.id);
  }
  if (isCandidateId(it?.offer_candidate_id))
    return String(it.offer_candidate_id);
  if (isCandidateId(it?.candidate?.id)) return String(it.candidate.id);
  return null;
}

async function buscarOfferIdCandidate(mlb) {
  let token = null;
  const wanted = String(mlb || "").toUpperCase();
  for (let i = 0; i < 200; i++) {
    const qs = qsBuild({
      limit: 50,
      status: "candidate",
      ...(token ? { search_after: token } : {}),
    });
    const data = await getJSONAny(
      itemsPaths(state.selectedCard.id, state.selectedCard.type, qs)
    );
    const items = Array.isArray(data?.results) ? data.results : [];
    const found = items.find(
      (x) => String(x?.id || "").toUpperCase() === wanted
    );
    if (found) {
      const ids = getAllOfferLikeIds(found);
      const cid = ids.find(isCandidateId) || null;
      const off = ids.find((id) => !isCandidateId(id)) || null;
      return { candidateId: cid, offerId: off };
    }
    token = data?.paging?.searchAfter || null;
    if (!token) break;
  }
  return { candidateId: null, offerId: null };
}

/* ======================== Ações: aplicar/remover ======================== */

function calcDealPriceFromItem(it) {
  const orig = toNum(it.original_price ?? it.price ?? null);
  const typeUp = (state.selectedCard?.type || "").toUpperCase();

  if (["DEAL", "SELLER_CAMPAIGN", "PRICE_DISCOUNT", "DOD"].includes(typeUp)) {
    const { final } = resolveDealFinalAndPctFront({
      original_price: orig,
      status: it.status,
      deal_price: it.deal_price ?? it.new_price,
      min_discounted_price: it.min_discounted_price,
      suggested_discounted_price: it.suggested_discounted_price,
      max_discounted_price: it.max_discounted_price,
      price: it.price,
    });
    if (final != null) return round2(final);
  }

  // Demais tipos / fallback
  const deal = toNum(it.deal_price ?? null);
  let d = toNum(it.discount_percentage);
  if (!Number.isNaN(deal) && deal != null) return round2(deal);
  if (orig != null && d != null) return round2(orig * (1 - d / 100));
  return null;
}

/* --- aplicarUnico (orig) --- mantido para botões da UI (opera no item já visível) */
async function aplicarUnico(mlb, opts = {}) {
  const silent = !!opts.silent;
  if (!state.selectedCard) {
    if (!silent) alert("Selecione uma campanha.");
    return false;
  }

  const it = state.items.find(
    (x) => (x.id || "").toUpperCase() === (mlb || "").toUpperCase()
  );
  if (!it) {
    if (!silent) alert("Item não encontrado na lista atual.");
    return false;
  }

  const t = (state.selectedCard.type || "").toUpperCase();
  if (t === "PRICE_MATCHING_MELI_ALL") {
    if (!silent)
      alert(
        "Esta campanha (PRICE_MATCHING_MELI_ALL) é 100% gerida pelo ML. Aplicação manual indisponível."
      );
    HUD.bump("errors");
    HUD.tickProcessed();
    return false;
  }

  const payloadBase = {
    promotion_id: state.selectedCard.id,
    promotion_type: t,
  };

  // inicia HUD se ainda não estiver visível
  if (!state.applySession.started) HUD.open(/* totalHint */ null);

  try {
    let payload = { ...payloadBase };

    if (t === "SELLER_CAMPAIGN" || t === "DEAL") {
      let dealPrice = calcDealPriceFromItem(it);
      if (dealPrice == null && !silent) {
        const entrada = prompt("Informe o NOVO preço (ex: 99.90):");
        if (!entrada) return false;
        const num = Number(String(entrada).replace(",", "."));
        if (Number.isNaN(num) || num <= 0)
          return alert("Preço inválido."), false;
        dealPrice = round2(num);
      } else if (dealPrice == null) {
        HUD.tickProcessed();
        return false; // silencioso
      }
      payload.deal_price = dealPrice;
    } else if (t === "SMART" || t.startsWith("PRICE_MATCHING")) {
      const status = normalizeStatus(it.status);
      if (status !== "candidate") {
        if (!silent)
          alert(
            `Este item não está candidato nesta campanha (status: ${
              status || "—"
            }).`
          );
        HUD.bump("errors");
        HUD.tickProcessed();
        return false;
      }

      // tenta obter ids
      let candidateId = extractCandidateIdFromItem(it);
      let offerId =
        getAllOfferLikeIds(it).find((id) => !isCandidateId(id)) || null;

      if (!candidateId || !offerId) {
        const { candidateId: c2, offerId: o2 } = await buscarOfferIdCandidate(
          mlb
        );
        candidateId = candidateId || c2;
        offerId = offerId || o2;
      }

      if (!candidateId && !offerId) {
        if (!silent) alert("Candidato não encontrado para este item.");
        HUD.bump("errors");
        HUD.tickProcessed();
        return false;
      }

      // Envie sempre offer_id quando existir e, opcionalmente, candidate_id.
      if (offerId) payload.offer_id = offerId;
      if (candidateId) payload.candidate_id = candidateId;
    } else {
      // tipos sem extra (MARKETPLACE_CAMPAIGN etc)
    }

    // função auxiliar para enviar
    const doPost = async (pl) => {
      const r = await fetch(
        `/api/promocoes/items/${encodeURIComponent(mlb)}/apply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(pl),
        }
      );
      let respBody = null;
      try {
        respBody = await r.clone().json();
      } catch {
        respBody = {};
      }
      return { ok: r.ok, status: r.status, body: respBody };
    };

    // 1ª tentativa
    let res = await doPost(payload);

    // fallback: se 400 e mensagem sugerir problema com id -> tenta offer_id explícito
    const bodyMsg = String(
      res?.body?.message || res?.body?.error || ""
    ).toLowerCase();
    const shouldRetryWithOffer =
      !res.ok &&
      res.status === 400 &&
      !("offer_id" in payload) &&
      "candidate_id" in payload &&
      (bodyMsg.includes("offer") ||
        bodyMsg.includes("candidate") ||
        bodyMsg.includes("invalid") ||
        bodyMsg.includes("not found"));

    if (shouldRetryWithOffer) {
      let offerId =
        getAllOfferLikeIds(it).find((id) => !isCandidateId(id)) || null;
      if (!offerId) {
        const found = await buscarOfferIdCandidate(mlb);
        offerId = found.offerId || found.candidateId;
      }
      if (offerId) {
        const retryPayload = { ...payloadBase, offer_id: offerId };
        res = await doPost(retryPayload);
      }
    }

    if (!res.ok) {
      const causes = Array.isArray(res?.body?.cause)
        ? res.body.cause
            .map((c) => c?.message || c?.code)
            .filter(Boolean)
            .join(" | ")
        : "";
      if (!silent) {
        alert(
          `Erro ao aplicar (${res.status}): ${
            res?.body?.message || res?.body?.error || "bad_request"
          }${causes ? "\nCausa: " + causes : ""}`
        );
      }
      state.applySession.errors++;
      HUD.tickProcessed();
      return false;
    }

    // sucesso -> estatística
    const prevStatus = normalizeStatus(it.status);
    if (prevStatus === "candidate") state.applySession.added++;
    else state.applySession.changed++;
    // marca localmente como started
    it.status = "started";

    if (!silent) {
      alert("Aplicado com sucesso!");
      if (state.mlbFilter) await carregarSomenteMLBSelecionado();
      else await carregarItensPagina(state.paging.currentPage, true);
    }
    HUD.tickProcessed();
    return true;
  } catch (e) {
    console.error("Erro aplicarUnico:", e);
    state.applySession.errors++;
    if (!silent) alert("Falha ao aplicar (ver console).");
    HUD.tickProcessed();
    return false;
  }
}

window.aplicarUnico = aplicarUnico;

/* --- aplicarUnicoRemote: mesma lógica de aplicarUnico mas busca o item quando não está na página atual.
       Usado no fallback do apply-bulk para aplicar todos os MLBS filtrados (todas as páginas). */

async function aplicarUnicoRemote(mlb, opts = {}) {
  const silent = !!opts.silent;
  if (!state.selectedCard) {
    if (!silent) alert("Selecione uma campanha.");
    return false;
  }

  // busca item por várias estratégias (rápido -> campanha)
  let it = null;
  try {
    it = await montarItemRapido(mlb).catch(() => null);
    if (!it) {
      const viaCampanha = await buscarItemNaCampanha(mlb);
      if (viaCampanha) it = viaCampanha;
    }
  } catch (e) {
    console.warn("buscar item remoto falhou:", e);
  }

  if (!it) {
    if (!silent)
      console.warn(`Item ${mlb} não encontrado na campanha (remote). Pulando.`);
    state.applySession.errors++;
    HUD.tickProcessed();
    return false;
  }

  // reaproveitar lógica de construir payload e postar (mesma de aplicarUnico)
  const t = (state.selectedCard.type || "").toUpperCase();
  if (t === "PRICE_MATCHING_MELI_ALL") {
    if (!silent)
      console.warn(
        "Campanha PRICE_MATCHING_MELI_ALL é gerida pelo ML. Pulando",
        mlb
      );
    state.applySession.errors++;
    HUD.tickProcessed();
    return false;
  }

  const payloadBase = {
    promotion_id: state.selectedCard.id,
    promotion_type: t,
  };
  try {
    let payload = { ...payloadBase };

    if (t === "SELLER_CAMPAIGN" || t === "DEAL") {
      let dealPrice = calcDealPriceFromItem(it);
      if (dealPrice == null) {
        if (!silent) {
          const entrada = prompt(
            `Informe o NOVO preço para ${mlb} (ex: 99.90):`
          );
          if (!entrada) return false;
          const num = Number(String(entrada).replace(",", "."));
          if (Number.isNaN(num) || num <= 0)
            return alert("Preço inválido."), false;
          dealPrice = round2(num);
        } else {
          state.applySession.errors++;
          HUD.tickProcessed();
          return false;
        }
      }
      payload.deal_price = dealPrice;
    } else if (t === "SMART" || t.startsWith("PRICE_MATCHING")) {
      const status = normalizeStatus(it.status);
      if (status !== "candidate") {
        if (!silent)
          console.warn(
            `Item ${mlb} não está candidate (status ${status}). Pulando.`
          );
        state.applySession.errors++;
        HUD.tickProcessed();
        return false;
      }

      // tenta ids direto do item primeiro
      let candidateId = extractCandidateIdFromItem(it);
      let offerId =
        getAllOfferLikeIds(it).find((id) => !isCandidateId(id)) || null;

      if (!candidateId || !offerId) {
        const found = await buscarOfferIdCandidate(mlb);
        candidateId = candidateId || found.candidateId;
        offerId = offerId || found.offerId;
      }

      if (!candidateId && !offerId) {
        if (!silent)
          console.warn(`Candidato/offer não encontrado para ${mlb}. Pulando.`);
        state.applySession.errors++;
        HUD.tickProcessed();
        return false;
      }

      if (offerId) payload.offer_id = offerId;
      if (candidateId) payload.candidate_id = candidateId;
    }

    const doPost = async (pl) => {
      const r = await fetch(
        `/api/promocoes/items/${encodeURIComponent(mlb)}/apply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(pl),
        }
      );
      let respBody = null;
      try {
        respBody = await r.clone().json();
      } catch {
        respBody = {};
      }
      return { ok: r.ok, status: r.status, body: respBody };
    };

    let res = await doPost(payload);

    // tentativa com offer explicit se houver erro e candidate presente
    const bodyMsg = String(
      res?.body?.message || res?.body?.error || ""
    ).toLowerCase();
    const shouldRetryWithOffer =
      !res.ok &&
      res.status === 400 &&
      !("offer_id" in payload) &&
      "candidate_id" in payload &&
      (bodyMsg.includes("offer") ||
        bodyMsg.includes("candidate") ||
        bodyMsg.includes("invalid") ||
        bodyMsg.includes("not found"));

    if (shouldRetryWithOffer) {
      let offerId =
        getAllOfferLikeIds(it).find((id) => !isCandidateId(id)) || null;
      if (!offerId) {
        const found = await buscarOfferIdCandidate(mlb);
        offerId = found.offerId || found.candidateId;
      }
      if (offerId) {
        const retryPayload = { ...payloadBase, offer_id: offerId };
        res = await doPost(retryPayload);
      }
    }

    if (!res.ok) {
      console.warn(`Falha ao aplicar ${mlb}:`, res.status, res.body);
      state.applySession.errors++;
      HUD.tickProcessed();
      return false;
    }

    // sucesso
    const prevStatus = normalizeStatus(it.status);
    if (prevStatus === "candidate") state.applySession.added++;
    else state.applySession.changed++;
    state.applySession.processed++;
    HUD.tickProcessed();

    return true;
  } catch (e) {
    console.error("Erro aplicarUnicoRemote:", e);
    state.applySession.errors++;
    HUD.tickProcessed();
    return false;
  }
}
/* --- Remoção em massa (abre HUD e atualiza contadores) --- */
async function removerEmMassaSelecionados() {
  if (!state.selectedCard) {
    alert("Selecione uma campanha.");
    return;
  }

  let itens = getSelecionados();
  if (!itens.length) {
    const ok = confirm(
      "Nenhum item marcado. Deseja remover TODOS os itens filtrados da campanha?"
    );
    if (!ok) return;
    itens = await coletarTodosIdsFiltrados();
  }
  if (!itens.length) {
    alert("Nenhum item para remover.");
    return;
  }

  // abre HUD
  HUD.open(itens.length, "Remoção em massa");

  try {
    const r = await fetch("/api/promocoes/jobs/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ items: itens, delay_ms: 250 }),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || !resp.ok) {
      console.error("Falha ao iniciar remoção em massa", r.status, resp);
      state.applySession.errors++;
      HUD.render();
      alert("Falha ao iniciar remoção em massa.");
      return;
    }
    // não sabemos a evolução do job aqui; apenas marcamos a intenção
    state.applySession.removed += itens.length;
    state.applySession.processed += itens.length;
    HUD.render();
    alert(`Remoção em massa iniciada para ${itens.length} item(ns).`);
  } catch (e) {
    console.error("Erro removerEmMassaSelecionados:", e);
    state.applySession.errors++;
    HUD.render();
    alert("Erro ao iniciar remoção em massa.");
  } finally {
    atualizarFaixaSelecaoCampanha();
  }
}

/* --- Aplicar todos filtrados (usa apply-bulk -> se falhar faz fallback local) --- */
async function aplicarTodosFiltrados() {
  if (!state.selectedCard) {
    alert("Selecione uma campanha.");
    return;
  }

  // Snapshot de filtros atuais (o backend aceita estes nomes)
  const filters = {
    query_mlb: state.mlbFilter || null,
    status: (function () {
      const s = filtroToStatusParam(); // '' | 'started' | 'candidate' | 'scheduled'
      return s || "all";
    })(),
    discount_max: state.maxDesc != null ? Number(state.maxDesc) : null,
  };

  // 1) Tenta estimar total para o progresso "x/y"
  let expected_total = null;
  try {
    const prepBody = {
      promotion_id: state.selectedCard.id,
      promotion_type: state.selectedCard.type,
      status: filtroToStatusParam() || null,
      mlb: state.mlbFilter || null,
      percent_max: state.maxDesc != null ? Number(state.maxDesc) : null,
    };
    const prepRes = await fetch("/api/promocoes/selection/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(prepBody),
    });
    const prepJson = await prepRes.json().catch(() => ({}));
    if (prepRes.ok && typeof prepJson?.total === "number") {
      expected_total = prepJson.total;
    }
  } catch {
    /* segue sem total */
  }

  // 2) HUD com total se conhecido
  HUD.open(expected_total ?? null, "Aplicação em massa");

  // -------- montar o NOME da campanha com vários fallbacks -----
  const buildCampaignName = () => {
    const n1 = state.selectedCard?.name || "";
    const n2 = (document.getElementById("campName")?.textContent || "")
      .replace(/^Campanha:\s*[“"]?/, "")
      .replace(/[”"]?$/, "")
      .trim();
    const n3 =
      state.cards.find?.((c) => c.id === state.selectedCard?.id)?.name || "";
    return n1 || n2 || n3 || String(state.selectedCard?.id || "Campanha");
  };
  const campaignName = buildCampaignName();
  const account = window.__ACCOUNT__ || {};

  // 3) placeholder no JobsPanel
  let localJobId = null;
  try {
    localJobId =
      window.JobsPanel?.addLocalJob?.({
        title: `Aplicando ${state.selectedCard?.type || ""} • ${campaignName}`,
        accountKey: account.key || null,
        accountLabel: account.label || null,
      }) || null;

    if (expected_total != null) {
      window.JobsPanel?.updateLocalJob?.(localJobId, {
        state: `queued 0/${expected_total}`,
        progress: 0,
      });
    }
    window.JobsPanel?.show?.();
  } catch {
    /* opcional */
  }

  // 4) Dispara o job no backend (passa expected_total quando conhecido)
  try {
    const options = { dryRun: false };
    if (typeof expected_total === "number")
      options.expected_total = expected_total;

    const res = await fetch(
      `/api/promocoes/promotions/${encodeURIComponent(
        state.selectedCard.id
      )}/apply-bulk`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          promotion_type: state.selectedCard.type,
          filters,
          options,
        }),
      }
    );

    const data = await res.json().catch(() => ({}));
    if (res.ok && (data?.success === true || data?.job_id)) {
      // vincula placeholder ao job real e reforça o título
      if (localJobId && data?.job_id) {
        const realId = String(data.job_id);
        JobTitleCache.set(
          realId,
          `Aplicando ${state.selectedCard?.type || ""} • ${campaignName}`
        );
        window.JobsPanel?.replaceId?.(localJobId, realId);
        window.JobsPanel?.updateLocalJob?.(realId, {
          label: `Aplicando ${
            state.selectedCard?.type || ""
          } • ${campaignName}`,
          ...(expected_total != null
            ? { state: `active 0/${expected_total}`, progress: 0 }
            : {}),
        });
      }

      // garantir que o watcher esteja ativo
      JobsWatcher.start?.();
      alert(
        "Aplicação em massa iniciada. Acompanhe o progresso no painel de processos."
      );
      return;
    }

    // Se aqui, algo não foi OK no apply-bulk -> faz fallback local (iterando páginas)
    console.warn(
      "apply-bulk não iniciou job, executando fallback local",
      res.status,
      data
    );

    // 5) coletar todos ids filtrados
    const ids = await coletarTodosIdsFiltrados();
    if (!ids.length) {
      alert(
        "Não foi possível iniciar a aplicação em massa (nenhum item localizado para aplicar)."
      );
      return;
    }

    // ajusta HUD com total conhecido agora
    HUD.open(ids.length, "Aplicação em massa (fallback)");
    state.applySession.processed = 0;
    state.applySession.added = 0;
    state.applySession.changed = 0;
    state.applySession.errors = 0;

    // Atualiza JobsPanel placeholder se existir
    if (localJobId) {
      window.JobsPanel?.updateLocalJob?.(localJobId, {
        state: `active 0/${ids.length}`,
        progress: 0,
      });
    }

    // 6) aplica em batches com concorrência limitada
    const concurrency = 4;
    const chunks = chunkArray(ids, concurrency);
    let processedCount = 0;

    for (const batch of chunks) {
      const results = await Promise.allSettled(
        batch.map((id) => aplicarUnicoRemote(id, { silent: true }))
      );

      // conta resultados
      for (const r of results) {
        if (r.status !== "fulfilled" || r.value !== true) {
          state.applySession.errors++;
        }
        processedCount++;
        state.applySession.processed = processedCount;
      }

      // atualizar painel local job
      if (localJobId) {
        const progress = Math.round((processedCount / ids.length) * 100);
        window.JobsPanel?.updateLocalJob?.(localJobId, {
          state: `active ${processedCount}/${ids.length}`,
          progress,
        });
      }

      await sleep(200);
    }

    // final
    state.applySession.started = false;
    HUD.render();
    alert(
      `Aplicação em massa (fallback) finalizada. Processados: ${state.applySession.processed}, Erros: ${state.applySession.errors}`
    );
    return;
  } catch (e) {
    console.error("Erro aplicarTodosFiltrados:", e);
    // fallback extremo
    try {
      const ids = await coletarTodosIdsFiltrados();
      if (ids.length) {
        HUD.open(ids.length, "Aplicação em massa (fallback extremo)");
        for (const mlb of ids) {
          await aplicarUnicoRemote(mlb, { silent: true });
        }
        HUD.render();
        alert("Aplicação em massa (fallback extremo) concluída.");
        return;
      }
    } catch (err) {
      console.error("Fallback extremo falhou:", err);
    }
    state.applySession.errors++;
    HUD.render();
    alert("Erro ao iniciar aplicação em massa.");
  } finally {
    atualizarFaixaSelecaoCampanha();
  }
}

window.aplicarLoteSelecionados = async function () {
  const sel = getSelecionados();
  if (!sel.length) return alert("Selecione ao menos 1 item");
  HUD.open(sel.length, "Aplicação (selecionados)");
  for (const mlb of sel) {
    await aplicarUnico(mlb, { silent: true });
  }
  atualizarFaixaSelecaoCampanha();
};

/* --- Navegação e helpers --- */
async function goPage(n) {
  if (!n || n === state.paging.currentPage) return;
  await carregarItensPagina(n, false);
}
function toggleTodos(master) {
  $$("#tbody input[type='checkbox'][data-mlb]").forEach(
    (ch) => (ch.checked = master.checked)
  );
  if (window.PromoBulk) {
    window.PromoBulk.onHeaderToggle(!!master.checked);
  }
  atualizarFaixaSelecaoCampanha();
}
function getSelecionados() {
  return $$("#tbody input[type='checkbox'][data-mlb]:checked").map(
    (el) => el.dataset.mlb
  );
}

async function coletarTodosIdsFiltrados() {
  if (!state.selectedCard) return [];

  // Se tiver MLB específico, não precisa varrer páginas
  const only = (state.mlbFilter || "").trim().toUpperCase();
  if (only) return [only];

  const statusParam = filtroToStatusParam();
  let token = null;

  const out = [];
  const seen = new Set();

  for (let i = 0; i < 500; i++) {
    const qs = qsBuild({
      limit: PAGE_SIZE,
      ...(statusParam ? { status: statusParam } : {}),
      ...(token ? { search_after: token } : {}),
    });

    const data = await getJSONAny(
      itemsPaths(state.selectedCard.id, state.selectedCard.type, qs)
    );

    if (data?.promotion_benefits)
      state.promotionBenefits = data.promotion_benefits;

    let items = Array.isArray(data?.results) ? data.results : [];
    items = items.map((x) => ({ ...x, status: normalizeStatus(x.status) }));
    items = dedupeByMLB(items, statusParam || "");

    // Aplica maxDesc aqui também, pra refletir “filtrados”
    if (state.maxDesc != null) {
      const benefitsGlobal =
        state.promotionBenefits || state.selectedCard?.benefits || null;

      items = items.filter((x) => {
        const descPct = computeDescPct(x, benefitsGlobal);
        return descPct != null && Number(descPct) <= Number(state.maxDesc);
      });
    }

    for (const it of items) {
      const id = String(it?.id || "").toUpperCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }

    token = data?.paging?.searchAfter || null;
    if (!token) break;
  }

  out.sort(sortByMLBAsc);
  return out;
}

function removerUnicoDaCampanha(mlb) {
  alert(`(stub) Remover ${mlb} da campanha ${state.selectedCard?.id || ""}`);
}

window.goPage = goPage;
window.toggleTodos = toggleTodos;
window.removerUnicoDaCampanha = removerUnicoDaCampanha;
window.removerEmMassaSelecionados = removerEmMassaSelecionados;
window.aplicarTodosFiltrados = aplicarTodosFiltrados;
/* ======================== Modo busca unitária (apenas 1 MLB) ======================== */

async function carregarSomenteMLBSelecionado() {
  const $body = elTbody();
  if (!state.selectedCard) {
    $body.innerHTML = `<tr><td colspan="12" class="muted">Selecione uma campanha.</td></tr>`;
    return;
  }
  const mlb = (state.mlbFilter || "").trim().toUpperCase();
  if (!mlb) {
    await carregarItensPagina(1, true);
    return;
  }

  try {
    state.loading = true;
    renderPaginacao();
    $body.innerHTML = `<tr><td colspan="12" class="muted">Carregando item ${esc(
      mlb
    )}…</td></tr>`;

    // monta rapidamente a linha usando as mesmas regras de cálculo do grid
    const it = await montarItemRapido(mlb);
    if (!it) {
      $body.innerHTML = `<tr><td colspan="12" class="muted">Item ${esc(
        mlb
      )} não localizado para esta campanha.</td></tr>`;
      state.items = [];
      state.paging = {
        total: 0,
        limit: PAGE_SIZE,
        tokensByPage: { 1: null },
        currentPage: 1,
        lastPageKnown: 1,
      };
      renderPaginacao();
      return;
    }

    // guarda e renderiza somente ele
    state.items = [it];
    state.paging.total = 1;
    state.paging.currentPage = 1;
    state.paging.tokensByPage = { 1: null };
    renderTabela(state.items);
    renderPaginacao();
    applyRebateHeaderTooltip();

    // tentar “hidratar” sugestões se o item for DEAL candidate seco
    await hydrateDealCandidateSuggestions(state.items);
  } catch (e) {
    console.error("[carregarSomenteMLBSelecionado] erro:", e);
    $body.innerHTML = `<tr><td colspan="12" class="muted">Falha ao carregar ${esc(
      mlb
    )} (ver console).</td></tr>`;
  } finally {
    state.loading = false;
    renderPaginacao();
    atualizarFaixaSelecaoCampanha();
  }
}

// cole perto dos outros helpers de UI
async function atualizarFaixaSelecaoCampanha() {
  try {
    if (!state.selectedCard) {
      const faixa = document.querySelector('[data-js="selecionados-banner"]');
      if (faixa) faixa.textContent = "";
      return;
    }

    const body = {
      promotion_id: state.selectedCard.id,
      promotion_type: state.selectedCard.type,
      status: filtroToStatusParam() || null,
      mlb: state.mlbFilter || null,
      percent_max: state.maxDesc != null ? Number(state.maxDesc) : null,
    };

    const r = await fetch("/api/promocoes/selection/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const totalFiltrados = r.ok && typeof j.total === "number" ? j.total : null;

    const faixa = document.querySelector('[data-js="selecionados-banner"]');
    if (faixa) {
      const paginaSel = getSelecionados().length;
      faixa.textContent = `${paginaSel} selecionados nesta página • toda a campanha: ${
        totalFiltrados ?? "…"
      } selecionados (filtrados)`;
    }
  } catch (_) {
    // silencioso
  }
}

/* ======================== Exports de utilidade no window ======================== */

window.__PromoState = state;
window.__JobsWatcher = JobsWatcher;

/* ======================== Shims opcionais (evita erros se painel não existir) ======================== */

if (!window.JobsPanel) {
  window.JobsPanel = {
    addLocalJob(info) {
      const id = `local-${Date.now()}`;
      console.log(`JobsPanel shim: addLocalJob ${id} "${info?.title || ""}"`);
      return id;
    },
    updateLocalJob(id, data) {
      console.log(`JobsPanel shim: update ${id} → ${JSON.stringify(data)}`);
    },
    replaceId(oldId, newId) {
      console.log(`JobsPanel shim: replace ${oldId} → ${newId}`);
    },
    mergeApiJobs(list) {
      console.log("JobsPanel shim: mergeApiJobs", list);
    },
    show() {
      console.log("JobsPanel shim: show()");
    },
  };
}

if (!window.PromoBulk) {
  window.PromoBulk = {
    setContext(ctx) {
      console.log(`PromoBulk shim: context → ${JSON.stringify(ctx)}`);
    },
    onHeaderToggle(all) {
      console.log(`PromoBulk shim: header toggle = ${all}`);
    },
  };
}

/* ======================== Guard rails para erros não-capturados ======================== */

window.addEventListener("unhandledrejection", (ev) => {
  try {
    console.error(
      `Promise rejeitada: ${ev.reason?.message || ev.reason || "erro"}`
    );
  } catch {}
});

window.addEventListener("error", (ev) => {
  try {
    console.error(`Erro JS: ${ev.message} @ ${ev.filename}:${ev.lineno}`);
  } catch {}
});

/* ======================== Helpers de comparação e ordenação (se precisar) ======================== */

// Ordena por MLB asc de forma segura
function sortByMLBAsc(a, b) {
  const sa = String(a?.id || a).toUpperCase();
  const sb = String(b?.id || b).toUpperCase();
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

// Clamp numérico (utilitário eventual)
function clamp(n, min, max) {
  n = Number(n);
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/* ======================== Experimentos / flags (mantido para toggles rápidos) ======================== */

const Flags = {
  dealPricePriceDeltaEnabled: true,
  jobsWatcherEnabled: true,
};

console.log("Flags ativas: " + JSON.stringify(Flags));

async function exportCSV() {
  const safeProgress = (cur, tot, opts) =>
    progressFab && typeof progressFab.progress === "function"
      ? progressFab.progress(cur, tot, opts)
      : null;

  try {
    setLoading(true);
    progressFab.show("Carregando dados para exportação…");

    const allRows = await fetchAllPages(
      ({ page, totalPages, withAds }) =>
        safeProgress(page, totalPages, { withAds }),
      { limit: 120, withAds: true, timeoutMs: 120000, strictAds: true }
    );

    progressFab.message("Gerando CSV…");

    const rowsForCsv = allRows.slice();
    if (state.sort === "share" || state.metric === "revenue") {
      rowsForCsv.sort(
        (a, b) => (b.revenue_cents || 0) - (a.revenue_cents || 0)
      );
    } else {
      rowsForCsv.sort((a, b) => (b.units || 0) - (a.units || 0));
    }

    const rowsFiltered = rowsForCsv.filter((r) => Number(r.units || 0) > 0);

    const uTotal = rowsFiltered.reduce((s, r) => s + (r.units || 0), 0);
    const rTotal = rowsFiltered.reduce((s, r) => s + (r.revenue_cents || 0), 0);

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

    const rows = rowsFiltered.map((r) => {
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
      const statusText = ads.status_text || (ads.in_campaign ? "Ativo" : "Não");

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

    const data = [head, ...rows]
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
    alert("❌ Falha ao exportar CSV: " + (e?.message || e));
  } finally {
    setLoading(false);
  }
}

/* ======================== Boot ======================== */

document.addEventListener("DOMContentLoaded", async () => {
  hideLeadingRebateColumnIfPresent();
  updateSelectedCampaignName();
  HUD.reset();

  if (Flags.jobsWatcherEnabled) JobsWatcher.start();
  else JobsWatcher.stop();

  await carregarCards();
  atualizarFaixaSelecaoCampanha();
});
