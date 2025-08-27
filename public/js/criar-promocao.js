// public/js/criar-promocao.js
console.log('🚀 criar-promocao.js carregado');

const toAbs = (p) => (/^https?:\/\//i.test(p) ? p : (p.startsWith('/') ? p : `/${p}`));

async function getJSONAny(paths) {
  let lastErr;
  for (const p of paths) {
    const url = toAbs(p);
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) {
        const body = await r.text().catch(()=> '');
        lastErr = new Error(`HTTP ${r.status} ${url}`);
        lastErr.cause = { status: r.status, body, url };
        console.warn(`❌ ${r.status} em ${url}`, body);
        continue;
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      console.warn('❌ Falha em', url, e.message || e);
    }
  }
  throw lastErr || new Error('Nenhum endpoint respondeu');
}

const usersPaths = () => [
  '/api/promocoes/users',
  '/api/promocao/users',
  '/api/promotions/users',
];
const itemsPaths = (promotionId, type, qs) => {
  const suffix = `?promotion_type=${encodeURIComponent(type)}${qs ? `&${qs}` : ''}`;
  const pid = encodeURIComponent(promotionId);
  return [
    `/api/promocoes/promotions/${pid}/items${suffix}`,
    `/api/promocao/promotions/${pid}/items${suffix}`,
    `/api/promotions/promotions/${pid}/items${suffix}`,
  ];
};

const PAGE_SIZE = 50;
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function esc(s){ return (s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))); }
const fmtMoeda = (n)=> (n==null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const fmtPerc  = (n,d=2)=> (n||n===0)?`${Number(n).toFixed(d)}%`:'—';
const round2   = (n)=> Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function elCards(){ return document.getElementById('cards'); }
function elTbody(){ return document.getElementById('tbody'); }
function elPag(){ return document.getElementById('paginacao'); }
function getTable(){ return elTbody()?.closest('table') || null; }

const state = {
  cards: [],
  cardsFilteredIds: null,
  items: [],
  selectedCard: null,
  promotionBenefits: null,
  filtroParticipacao: 'all',
  maxDesc: null,
  mlbFilter: '',
  paging: { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 },
  loading: false,
  searchMlb: null
};

/* ================= Helpers/UI ================= */

function toNum(x){ return (x===null || x===undefined || x==='') ? null : Number(x); }

// Lê rebate (MELI/Seller) de diversos formatos do payload
function pickRebate(obj){
  const b = obj?.benefits || {};
  const meli   = toNum(obj?.meli_percentage ?? obj?.meli_percent ?? b?.meli_percent);
  const seller = toNum(obj?.seller_percentage ?? obj?.seller_percent ?? b?.seller_percent);
  const type   = b?.type || (meli!=null ? 'REBATE' : null);
  return { type, meli, seller };
}

function hideLeadingRebateColumnIfPresent(){
  const table = getTable(); if (!table) return;
  const ths = table.querySelectorAll('thead th');
  if (ths.length && ths[0].textContent.trim().toLowerCase().startsWith('rebate')) {
    table.classList.add('hide-leading-rebate');
  }
}
function getRebateHeaderTh(){
  const table = getTable(); if (!table) return null;
  return [...table.querySelectorAll('thead th')].find(th => th.textContent.trim().toLowerCase().startsWith('rebate'));
}
function applyRebateHeaderTooltip(){
  const th = getRebateHeaderTh(); if (!th) return;
  const b = state.promotionBenefits || state.selectedCard?.benefits || null;

  let mlp = null, sp = null, type = b?.type || (state.selectedCard?.type || '—');

  if (b) {
    mlp = (b.meli_percent   != null) ? `${b.meli_percent}%`   : null;
    sp  = (b.seller_percent != null) ? `${b.seller_percent}%` : null;
  } else if (state.items?.length) {
    const set = new Set(
      state.items
        .map(x => (x.meli_percentage ?? x.rebate_meli_percent ?? pickRebate(x).meli))
        .filter(v => v != null)
    );
    mlp = (set.size === 1) ? `${[...set][0]}%` : 'varia por item';
  }

  const isRebate =
    (b?.type === 'REBATE') || ['SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL'].includes((state.selectedCard?.type||'').toUpperCase());
  const rebateTag = isRebate ? ' <span class="badge badge-rebate">REBATE</span>' : '';

  th.innerHTML = `Rebate <span class="tip" title="Tipo: ${type}\nMELI: ${mlp ?? '—'}\nSeller: ${sp ?? '—'}">ⓘ</span>${rebateTag}`;
}

/* ================= Eventos ================= */

document.addEventListener('click', (ev) => {
  const t = ev.target;

  if (t.closest?.('#btnFiltrarItem')) {
    ev.preventDefault();
    const mlb = ($('#mlbFilter')?.value || '').trim().toUpperCase();
    state.mlbFilter = mlb;
    console.log('[Buscar] MLB:', mlb || '(vazio)');
    if (!mlb) { state.cardsFilteredIds = null; renderCards(); return; }
    filtrarCardsPorMLB(mlb);
    return;
  }
  if (t.closest?.('#btnLimparItem')) {
    ev.preventDefault();
    state.mlbFilter = '';
    state.cardsFilteredIds = null;
    const input = $('#mlbFilter'); if (input) input.value = '';
    console.log('[Buscar] Limpo — exibindo todos os cards');
    renderCards();
    return;
  }
  if (t.closest?.('#btnMaxDescTable')) {
    ev.preventDefault();
    const v = $('#maxDescTableInput')?.value?.trim();
    state.maxDesc = (v === '' || v == null) ? null : Number(v);
    if (state.selectedCard) carregarItensPagina(1, true);
    return;
  }
  if (t.closest?.('#btnLimparMaxDescTable')) {
    ev.preventDefault();
    state.maxDesc = null;
    const input = $('#maxDescTableInput'); if (input) input.value = '';
    if (state.selectedCard) carregarItensPagina(1, true);
    return;
  }
});

document.addEventListener('change', (ev) => {
  const r = ev.target;
  if (r.name === 'filtro') {
    state.filtroParticipacao = r.value || 'all';
    if (state.selectedCard) carregarItensPagina(1, true);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target?.id === 'mlbFilter') {
    ev.preventDefault();
    const mlb = ev.target.value.trim().toUpperCase();
    state.mlbFilter = mlb;
    console.log('[Buscar] Enter MLB:', mlb || '(vazio)');
    if (!mlb) { state.cardsFilteredIds = null; renderCards(); return; }
    filtrarCardsPorMLB(mlb);
  }
});

// -------- busca por MLB (cards do item)
const ITEM_PROMO_TYPES = new Set([
  'SMART', 'MARKETPLACE_CAMPAIGN', 'DEAL', 'PRICE_MATCHING', 'PRICE_MATCHING_MELI_ALL', 'SELLER_CAMPAIGN'
]);

const itemPromosPaths = (mlb) => [
  `/api/promocoes/items/${encodeURIComponent(mlb)}`,
  `/api/promotions/items/${encodeURIComponent(mlb)}`,
  `/api/promocao/items/${encodeURIComponent(mlb)}`
];

async function buscarCardsDoItem(mlb) {
  for (const p of itemPromosPaths(mlb)) {
    try {
      const r = await fetch(p);
      if (!r.ok) continue;
      const arr = await r.json();

      const cards = (Array.isArray(arr) ? arr : (arr?.results ?? []))
        .filter(c => c && (c.id || c.name) && ITEM_PROMO_TYPES.has(String(c.type || '').toUpperCase()))
        .map(c => ({
          id: c.id,
          type: String(c.type || '').toUpperCase(),
          name: c.name || c.id || 'Campanha',
          status: c.status,
          start_date: c.start_date,
          finish_date: c.finish_date,
          benefits: c.benefits || null
        }));

      return cards;
    } catch { /* tenta próxima rota */ }
  }
  return [];
}


/* ================= Cards ================= */

async function carregarCards(){
  const $cards = elCards();
  $cards.classList.add('cards-grid');
  $cards.innerHTML = `<div class="card"><h3>Carregando promoções…</h3><div class="muted">Aguarde</div></div>`;
  try {
    // FIX: chamar apenas uma vez (evitava sobrescrever filtro de MLB)
    const data = await getJSONAny(usersPaths());
    state.cards = Array.isArray(data.results) ? data.results : [];
    console.log(`ℹ️ ${state.cards.length} cards carregados`);
    if (state.mlbFilter) await filtrarCardsPorMLB(state.mlbFilter);
    else renderCards();
  } catch (e) {
    const authMsg = (e?.cause?.status === 401 || e?.cause?.status === 403)
      ? 'Sua sessão com o Mercado Livre expirou ou não é de usuário. Clique em “Trocar Conta” e reconecte.'
      : 'Não foi possível carregar promoções (ver console).';
    $cards.innerHTML = `<div class="card"><h3>Falha</h3><pre class="muted">${esc(authMsg)}</pre></div>`;
  }
}

function renderCards(){
  const $cards = elCards();
  $cards.classList.add('cards-grid');
  const list = (state.cardsFilteredIds ? state.cards.filter(c => state.cardsFilteredIds.has(c.id)) : state.cards);

  if (!list.length) {
    const msg = state.mlbFilter
      ? `Nenhuma campanha oferece promoção para o item ${esc(state.mlbFilter)}.`
      : 'Nenhuma promoção disponível';
    $cards.innerHTML = `<div class="card"><h3>${msg}</h3></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.tabIndex = 0;

    const status = (c.status || '').toLowerCase();
    const pill = status === 'started' ? '<span class="pill">started</span>' : `<span class="pill muted">${esc(c.status || '')}</span>`;
    const fini = c.finish_date ? new Date(c.finish_date).toLocaleDateString('pt-BR') : '';

    const benefits = c.benefits || null;
    const benefitsStr = benefits
      ? `Rebate MELI: ${benefits.meli_percent ?? '—'}% • Seller: ${benefits.seller_percent ?? '—'}%`
      : '';

    const isRebate =
      (benefits?.type === 'REBATE') || ['SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL'].includes((c.type||'').toUpperCase());
    const rebateTag = isRebate ? '<span class="badge badge-rebate">REBATE</span>' : '';

    div.innerHTML = `<h3>${esc(c.name || c.id || 'Campanha')} ${rebateTag}</h3>
      <div class="muted">${esc(c.type || '')} ${pill}</div>
      <div class="muted">${fini ? 'Até ' + fini : ''}</div>
      ${benefitsStr ? `<div class="muted" style="margin-top:4px">${benefitsStr}</div>` : ''}`;

    div.addEventListener('click', () => selecionarCard(c));
    frag.appendChild(div);
  });

  $cards.innerHTML = '';
  $cards.appendChild(frag);
  destacarCardSelecionado();
}

function destacarCardSelecionado(){
  const $cards = elCards();
  [...$cards.children].forEach(n => n.classList.remove('card--active'));
  const list = (state.cardsFilteredIds ? state.cards.filter(c => state.cardsFilteredIds.has(c.id)) : state.cards);
  const idx = list.findIndex(c => c.id === state.selectedCard?.id);
  if (idx >= 0 && $cards.children[idx]) $cards.children[idx].classList.add('card--active');
}

// Busca por MLB: filtra cards que possuem promoção para o item
async function filtrarCardsPorMLB(mlb){
  try {
    const resp = await getJSONAny([`/api/promocoes/items/${encodeURIComponent(mlb)}/promotions`]);
    const promos = Array.isArray(resp.results) ? resp.results : [];
    const idsDoItem = new Set(promos.filter(p => p && p.id).map(p => p.id));
    state.cardsFilteredIds = new Set(state.cards.filter(c => idsDoItem.has(c.id)).map(c => c.id));
    renderCards();

    const list = state.cards.filter(c => state.cardsFilteredIds.has(c.id));
    if (list.length === 1) selecionarCard(list[0]);
  } catch (e) {
    console.warn('Falha ao buscar promoções do item; caindo para varredura lenta.', e);
    state.cardsFilteredIds = null;
    renderCards();
  }
}

/* ============== Seleção de card / Tabela ============== */

async function selecionarCard(card){
  state.selectedCard = {
    id: card.id,
    type: (card.type||'').toUpperCase(),
    name: card.name || card.id,
    benefits: card.benefits || null
  };
  state.promotionBenefits = null;
  state.paging = { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 };
  destacarCardSelecionado();
  hideLeadingRebateColumnIfPresent();
  applyRebateHeaderTooltip();
  updateSelectedCampaignName();

  if (state.mlbFilter) {
    await carregarSomenteMLBSelecionado(); // modo busca unitária
  } else {
    await carregarItensPagina(1, true);
  }
}

function qsBuild(params){
  const entries = Object.entries(params).filter(([,v]) => v!==undefined && v!==null && v!=='');
  return entries.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
function filtroToStatusParam(){
  switch (state.filtroParticipacao) {
    case 'yes': return 'started';
    case 'non': return 'candidate';
    default:    return '';
  }
}

async function carregarItensPagina(pageNumber, reset=false){
  const $body = elTbody();
  if (!state.selectedCard) {
    $body.innerHTML = `<tr><td colspan="12" class="muted">Clique em um card de promoção.</td></tr>`;
    return;
  }
  if (reset) {
    state.paging.tokensByPage = { 1:null };
    state.paging.currentPage = 1;
    state.paging.lastPageKnown = 1;
    $body.innerHTML = `<tr><td colspan="12" class="muted">Carregando itens…</td></tr>`;
  }

  state.loading = true;
  renderPaginacao();
  const targetPage = Math.max(1, pageNumber|0);
  let haveToken = state.paging.tokensByPage[targetPage] !== undefined;

  try {
    while (!haveToken) {
      const prev = state.paging.lastPageKnown;
      const prevToken = state.paging.tokensByPage[prev] ?? null;
      const qs = qsBuild({ limit: PAGE_SIZE, status: filtroToStatusParam(), ...(prevToken ? { search_after: prevToken } : {}) });
      const data = await getJSONAny(itemsPaths(state.selectedCard.id, state.selectedCard.type, qs));
      const nextToken = data?.paging?.searchAfter || null;
      const total = data?.paging?.total ?? 0;

      if (data?.promotion_benefits) state.promotionBenefits = data.promotion_benefits;

      state.paging.total = total;
      state.paging.tokensByPage[prev+1] = nextToken;
      state.paging.lastPageKnown = prev+1;
      haveToken = state.paging.tokensByPage[targetPage] !== undefined;
      if (!nextToken) break;
    }

    const token = state.paging.tokensByPage[targetPage] ?? null;
    const qs = qsBuild({ limit: PAGE_SIZE, status: filtroToStatusParam(), ...(token ? { search_after: token } : {}) });
    const data = await getJSONAny(itemsPaths(state.selectedCard.id, state.selectedCard.type, qs));

    if (data?.promotion_benefits) state.promotionBenefits = data.promotion_benefits;

    let items = Array.isArray(data.results) ? data.results : [];

    if (state.mlbFilter) {
      const mlbUp = state.mlbFilter.toUpperCase();
      items = items.filter(x => (x.id || '').toUpperCase() === mlbUp);
    }

    if (state.maxDesc != null) {
      items = items.filter(x => {
        const original = x.original_price ?? x.price ?? null;
        const deal     = x.deal_price ?? x.price ?? null;
        let descPct = x.discount_percentage;
        if ((descPct == null) && original && deal && Number(original) > 0) {
          descPct = (1 - (Number(deal)/Number(original))) * 100;
        }
        return (descPct == null) ? false : (Number(descPct) <= Number(state.maxDesc));
      });
    }

    state.items = items;
    state.paging.total = data?.paging?.total ?? state.paging.total;
    state.paging.currentPage = targetPage;

    renderTabela(state.items);
    renderPaginacao();
    applyRebateHeaderTooltip();
  } catch (e) {
    const authMsg = (e?.cause?.status === 401 || e?.cause?.status === 403)
      ? 'Sua sessão com o Mercado Livre expirou ou não é de usuário. Clique em “Trocar Conta” e reconecte.'
      : 'Falha ao listar itens (ver console).';
    $body.innerHTML = `<tr><td colspan="12" class="muted">${esc(authMsg)}</td></tr>`;
  } finally {
    state.loading = false;
    renderPaginacao();
  }
}

function renderTabela(items){
  const $body = elTbody();
  if (!items?.length) {
    $body.innerHTML = `<tr><td colspan="12" class="muted">Nenhum item para esta página.</td></tr>`;
    return;
  }

  const benefitsGlobal = state.promotionBenefits || state.selectedCard?.benefits || null;

  const rows = items.map((it) => {
    const mlb  = it.id || '';
    const tit  = it.title || '—';
    const est  = (it.available_quantity ?? it.stock ?? '—');
    const sku  = it.seller_custom_field ?? it.sku ?? '—';

    const original = toNum(it.original_price ?? it.price ?? null);
    let   deal     = toNum(it.deal_price     ?? it.price ?? null);

    let descPct = toNum(it.discount_percentage);
    // ➕ fallback: se vier original e deal, calcula o % de desconto
    if (descPct == null && original != null && deal != null && original > 0) {
      descPct = (1 - (deal / original)) * 100;
    }

    const rb = pickRebate(it);
    const isSmartLike = ['SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL'].includes((state.selectedCard?.type||'').toUpperCase());
    if (isSmartLike && original != null) {
      const m = (rb.meli   != null) ? rb.meli   : (benefitsGlobal?.meli_percent ?? null);
      const s = (rb.seller != null) ? rb.seller : (benefitsGlobal?.seller_percent ?? null);
      const tot = toNum((m||0) + (s||0));
      if (descPct == null && (m != null || s != null)) descPct = tot;
      if (deal   == null && descPct != null)           deal   = original * (1 - (descPct/100));
      if (it.rebate_meli_percent == null && m != null) it.rebate_meli_percent = m;
    }

    // "Novo preço": prioriza o valor de deal; se não houver, calcula pelo desconto
    const novo = (deal != null)
      ? deal
      : (original != null && descPct != null) ? round2(original * (1 - (descPct/100))) : null;

    const precoAtual = (original != null) ? fmtMoeda(original) : '—';
    const precoFinal = (deal     != null) ? fmtMoeda(deal)     : '—';
    const novoPreco  = (novo     != null) ? fmtMoeda(novo)     : '—';
    const status     = it.status || '—';

    const meliPct =
      (it.meli_percentage != null ? Number(it.meli_percentage)
        : it.rebate_meli_percent != null ? Number(it.rebate_meli_percent)
        : rb.meli != null ? Number(rb.meli)
        : benefitsGlobal?.meli_percent != null ? Number(benefitsGlobal.meli_percent)
        : null);

    const hasRebate = (meliPct != null) || (rb.type === 'REBATE') || (rb.meli != null);
    const rebateCell = hasRebate
      ? `${meliPct != null ? fmtPerc(meliPct, 2) + ' ' : ''}<span class="pill green">REBATE</span>`
      : '—';

    return `<tr>
      <td style="text-align:center"><input type="checkbox" data-mlb="${esc(mlb)}"></td>
      <td>${esc(mlb)}</td>
      <td>${esc(tit)}</td>
      <td>${esc(est)}</td>
      <td>${esc(sku)}</td>
      <td>${precoAtual}</td>
      <td>${descPct != null ? fmtPerc(descPct, 2) : '—'}</td>
      <td>${precoFinal}</td>
      <td>${rebateCell}</td>
      <td>${novoPreco}</td>
      <td>${esc(status)}</td>
      <td style="text-align:right">
        <button class="btn primary" onclick="aplicarUnico('${esc(mlb)}')">Aplicar</button>
        <button class="btn ghost" onclick="removerUnicoDaCampanha('${esc(mlb)}')">Remover</button>
      </td>
    </tr>`;
  }).join('');

  $body.innerHTML = rows;
}

function updateSelectedCampaignName(){
  const el = document.getElementById('campName');
  if (!el) return;
  if (state.selectedCard) {
    const name = state.selectedCard.name || state.selectedCard.id;
    el.textContent = name;
    el.title = name;
  } else {
    el.textContent = '— selecione um card —';
    el.title = '— selecione um card —';
  }
}

function renderPaginacao(){
  const $pag = elPag();
  $pag.innerHTML = '';
  if (state.loading) return;

  const total = Number(state.paging.total || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur   = state.paging.currentPage;

  const MAX_BTNS = 9;
  let start = Math.max(1, cur - Math.floor(MAX_BTNS/2));
  let end   = Math.min(pages, start + MAX_BTNS - 1);
  start = Math.max(1, end - MAX_BTNS + 1);

  const btn = (p, label = String(p), disabled = false, active = false) =>
    `<button class="page-btn${active?' active':''}" ${disabled?'disabled':''} onclick="goPage(${p})">${label}</button>`;

  let html = '';
  html += btn(Math.max(1, cur - 1), '‹', cur === 1);
  if (start > 1) {
    html += btn(1, '1', false, cur === 1);
    if (start > 2) html += `<span class="muted" style="padding:0 6px">…</span>`;
  }
  for (let p = start; p <= end; p++) html += btn(p, String(p), false, p === cur);
  if (end < pages) {
    if (end < pages - 1) html += `<span class="muted" style="padding:0 6px">…</span>`;
    html += btn(pages, String(pages), false, cur === pages);
  }
  html += btn(Math.min(pages, cur + 1), '›', cur === pages);

  $pag.innerHTML = html;
}

/* =========== Busca por MLB: linha única com fallback =========== */

// 1) método rápido — usa /items/:ITEM_ID/promotions e tenta um brief (se existir); falhando, segue normalmente
async function montarItemRapido(mlb){
  // promo do item
  const resp = await getJSONAny([`/api/promocoes/items/${encodeURIComponent(mlb)}/promotions`]);
  const promos = Array.isArray(resp.results) ? resp.results : [];
  const sel = state.selectedCard;
  const match = promos.find(p => p && p.id === sel.id) || null;
  if (!match) return null;

  // tenta detalhes rápidos do item (se rota não existir/der erro, ignora)
  let b = null;
  try {
    // ajuste aqui para a sua rota de detalhes/brief, se diferente:
    b = await getJSONAny([
      `/api/items/brief?ids=${encodeURIComponent(mlb)}`,
      `/api/items/basic?ids=${encodeURIComponent(mlb)}`
    ]);
    if (Array.isArray(b)) {
      const hit = b.find(x => (x.id === mlb || x?.body?.id === mlb));
      b = hit?.body || hit || null;
    }
  } catch (_) { /* sem brief, segue */ }

  const offer = Array.isArray(match.offers) && match.offers[0] ? match.offers[0] : {};
  const rb = pickRebate(match) || pickRebate(offer);

  const original = toNum(match.original_price ?? offer.original_price ?? b?.price ?? null);
  let   deal     = toNum(match.price ?? match.new_price ?? offer.new_price ?? offer.price ?? null);
  let   descPct  = toNum(match.discount_percentage);

  const type = (match.type || '').toUpperCase();
  if ((type === 'SMART' || type.startsWith('PRICE_MATCHING')) && original != null) {
    const tot = toNum((rb.meli || 0) + (rb.seller || 0));
    if (descPct == null && (rb.meli != null || rb.seller != null)) descPct = tot;
    if (deal   == null && descPct != null) deal = original * (1 - (descPct/100));
  }
  // fallback de desconto pelo par original/deal
  if (descPct == null && original != null && deal != null && original > 0) {
    descPct = (1 - (deal / original)) * 100;
  }

  return {
    id: mlb,
    title: b?.title || '—',
    available_quantity: b?.available_quantity ?? '—',
    seller_custom_field: b?.seller_custom_field ?? '—',
    original_price: original ?? null,
    deal_price: deal ?? null,
    discount_percentage: descPct ?? null,
    meli_percentage: (match.meli_percentage ?? offer.meli_percentage ?? rb.meli ?? null),
    rebate_meli_percent: (rb.meli != null ? Number(rb.meli) : null),
    status: offer?.status || match.status || '—',
    benefits: rb.type ? { type: rb.type, meli_percent: rb.meli, seller_percent: rb.seller } : undefined,
  };
}

// 2) fallback — percorre a listagem da própria campanha até achar o MLB
async function buscarItemNaCampanha(mlb){
  const mlbUp = (mlb || '').toUpperCase();
  let token = null;
  // limite de segurança para evitar loop infinito em campanhas enormes
  for (let i = 0; i < 200; i++) { // 200 * 50 = 10.000 itens
    const qs = qsBuild({ limit: 50, status: filtroToStatusParam(), ...(token ? { search_after: token } : {}) });
    const data = await getJSONAny(itemsPaths(state.selectedCard.id, state.selectedCard.type, qs));
    if (data?.promotion_benefits) state.promotionBenefits = data.promotion_benefits;

    const items = Array.isArray(data.results) ? data.results : [];
    const found = items.find(it => (it.id || '').toUpperCase() === mlbUp);
    if (found) return found;

    token = data?.paging?.searchAfter || null;
    if (!token) break;
  }
  return null;
}

async function carregarSomenteMLBSelecionado(){
  const $body = elTbody();
  $body.innerHTML = `<tr><td colspan="12" class="muted">Carregando item…</td></tr>`;
  state.loading = true;
  renderPaginacao();

  try {
    // primeiro tenta o caminho rápido
    let item = await montarItemRapido(state.mlbFilter.toUpperCase());

    // se não veio nada OU veio sem campos essenciais, faz fallback pela listagem da campanha
    const semDados =
      !item ||
      ((item.original_price == null) && (item.deal_price == null) && (item.discount_percentage == null));

    if (semDados) {
      const viaCampanha = await buscarItemNaCampanha(state.mlbFilter.toUpperCase());
      if (viaCampanha) item = viaCampanha;
    }

    if (!item) {
      $body.innerHTML = `<tr><td colspan="12" class="muted">Este item não possui oferta nesta campanha.</td></tr>`;
      state.items = [];
      state.paging = { total: 0, limit: PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 };
      renderPaginacao();
      return;
    }

    state.items = [item];
    state.paging = { total: 1, limit: PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 };

    renderTabela(state.items);
    applyRebateHeaderTooltip();
  } catch (e) {
    console.warn('Falha ao montar item único:', e);
    $body.innerHTML = `<tr><td colspan="12" class="muted">Erro ao carregar item (ver console).</td></tr>`;
  } finally {
    state.loading = false;
    renderPaginacao();
  }
}

/* ================= Ações (stubs) ================= */

async function goPage(n){ if (!n || n===state.paging.currentPage) return; await carregarItensPagina(n,false); }
function toggleTodos(master){ $$('#tbody input[type="checkbox"][data-mlb]').forEach(ch => ch.checked = master.checked); }
function getSelecionados(){ return $$('#tbody input[type="checkbox"][data-mlb]:checked').map(el => el.dataset.mlb); }
function aplicarLoteSelecionados(){
  const sel = getSelecionados();
  if (!sel.length) { alert('Selecione ao menos 1 item'); return; }
  alert(`(stub) Ação em lote com ${sel.length} itens`);
}
function removerUnicoDaCampanha(mlb){ alert(`(stub) Remover ${mlb} da campanha ${state.selectedCard?.id || ''}`); }
function aplicarUnico(mlb){ alert(`(stub) Aplicar no ${mlb} em ${state.selectedCard?.id || ''}`); }

window.goPage = goPage;
window.toggleTodos = toggleTodos;
window.aplicarLoteSelecionados = aplicarLoteSelecionados;
window.removerUnicoDaCampanha = removerUnicoDaCampanha;
window.aplicarUnico = aplicarUnico;

/* ================= Boot ================= */

document.addEventListener('DOMContentLoaded', async () => {
  hideLeadingRebateColumnIfPresent();
  updateSelectedCampaignName();
  await carregarCards();
});
