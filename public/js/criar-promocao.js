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
        const body = await r.text().catch(()=>'');
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
    `/api/promotions/promotions/${pid}/items${suffix}`
  ];
};

const PAGE_SIZE = 50;
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
function esc (s){ return (s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))); }
const fmtMoeda = (n)=> (n==null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const fmtPerc  = (n,d=2)=> (n||n===0)?`${Number(n).toFixed(d)}%`:'—';
const round2   = (n)=> Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function elCards(){ return document.getElementById('cards'); }
function elTbody(){ return document.getElementById('tbody'); }
function elPag(){ return document.getElementById('paginacao'); }
function getTable(){ return elTbody()?.closest('table') || null; }

const state = {
  cards: [],
  cardsFilteredIds: null, // Set<string> dos cards que têm o MLB buscado
  items: [],
  selectedCard: null,
  promotionBenefits: null,
  filtroParticipacao: 'all',
  maxDesc: null,
  mlbFilter: '',
  paging: { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 },
};

/* ======== UI helpers ======== */
function hideLeadingRebateColumnIfPresent() {
  const table = getTable(); if (!table) return;
  const ths = table.querySelectorAll('thead th');
  if (ths.length && ths[0].textContent.trim().toLowerCase().startsWith('rebate')) {
    table.classList.add('hide-leading-rebate');
  }
}
function getRebateHeaderTh() {
  const table = getTable(); if (!table) return null;
  return [...table.querySelectorAll('thead th')].find(th => th.textContent.trim().toLowerCase().startsWith('rebate'));
}
function applyRebateHeaderTooltip() {
  const th = getRebateHeaderTh(); if (!th) return;
  const b = state.promotionBenefits || state.selectedCard?.benefits || null;
  let mlp = null, sp = null, type = b?.type || (state.selectedCard?.type || '—');
  if (b) { mlp = (b.meli_percent != null)   ? `${b.meli_percent}%`   : null;
           sp  = (b.seller_percent != null) ? `${b.seller_percent}%` : null; }
  else if (state.items?.length) {
    const set = new Set(state.items.map(x => x.rebate_meli_percent).filter(v => v != null));
    mlp = (set.size === 1) ? `${[...set][0]}%` : 'varia por item';
  }
  const isRebateCampaign =
    (b?.type === 'REBATE') || ['SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL'].includes((state.selectedCard?.type||'').toUpperCase());
  const rebateTag = isRebateCampaign ? ' <span class="badge badge-rebate">REBATE</span>' : '';
  th.innerHTML = `Rebate <span class="tip" title="Tipo: ${type}\nMELI: ${mlp ?? '—'}\nSeller: ${sp ?? '—'}">ⓘ</span>${rebateTag}`;
}

/* ======== Delegação de eventos (funciona mesmo sem defer) ======== */
document.addEventListener('click', (ev) => {
  const t = ev.target;

  // Buscar MLB
  if (t.closest?.('#btnFiltrarItem')) {
    ev.preventDefault();
    const mlb = ($('#mlbFilter')?.value || '').trim().toUpperCase();
    state.mlbFilter = mlb;
    console.log('[Buscar] MLB:', mlb || '(vazio)');
    if (!mlb) { state.cardsFilteredIds = null; renderCards(); return; }
    filtrarCardsPorMLB(mlb);
    return;
  }

  // Limpar MLB
  if (t.closest?.('#btnLimparItem')) {
    ev.preventDefault();
    state.mlbFilter = '';
    state.cardsFilteredIds = null;
    const input = $('#mlbFilter'); if (input) input.value = '';
    console.log('[Buscar] Limpo — exibindo todos os cards');
    renderCards();
    return;
  }

  // Aplicar filtro de desconto
  if (t.closest?.('#btnMaxDescTable')) {
    ev.preventDefault();
    const v = $('#maxDescTableInput')?.value?.trim();
    state.maxDesc = (v === '' || v == null) ? null : Number(v);
    if (state.selectedCard) carregarItensPagina(1, true);
    return;
  }

  // Limpar filtro de desconto
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

/* ======== Cards ======== */
async function carregarCards() {
  const $cards = elCards();
  $cards.classList.add('cards-grid');
  $cards.innerHTML = `<div class="card"><h3>Carregando promoções…</h3><div class="muted">Aguarde</div></div>`;
  try {
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

function renderCards() {
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

    const isRebateCampaign =
      (benefits?.type === 'REBATE') || ['SMART','PRICE_MATCHING','PRICE_MATCHING_MELI_ALL'].includes((c.type||'').toUpperCase());
    const rebateTag = isRebateCampaign ? '<span class="badge badge-rebate">REBATE</span>' : '';

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

function destacarCardSelecionado() {
  const $cards = elCards();
  [...$cards.children].forEach(n => n.classList.remove('card--active'));
  const list = (state.cardsFilteredIds ? state.cards.filter(c => state.cardsFilteredIds.has(c.id)) : state.cards);
  const idx = list.findIndex(c => c.id === state.selectedCard?.id);
  if (idx >= 0 && $cards.children[idx]) $cards.children[idx].classList.add('card--active');
}

// Busca rápida: usa 1 chamada para listar TODAS promoções do item e filtra os cards por ID
async function filtrarCardsPorMLB(mlb) {
  try {
    const resp = await getJSONAny([`/api/promocoes/items/${encodeURIComponent(mlb)}/promotions`]);
    const promos = Array.isArray(resp.results) ? resp.results : [];
    // Alguns tipos (PRICE_DISCOUNT, DOD) não têm "id" — ignoramos, pois não existem como “card” aqui.
    const idsDoItem = new Set(promos.filter(p => p && p.id).map(p => p.id));

    // Mantém apenas os cards cujo id está presente na lista do item:
    state.cardsFilteredIds = new Set(state.cards.filter(c => idsDoItem.has(c.id)).map(c => c.id));
    renderCards();

    // Se desejar, já seleciona automaticamente o único card
    const list = state.cards.filter(c => state.cardsFilteredIds.has(c.id));
    if (list.length === 1) selecionarCard(list[0]);
  } catch (e) {
    console.warn('Falha ao buscar promoções do item; caindo para varredura lenta.', e);
    // Fallback: mantém sua varredura antiga (se quiser), senão apenas zera
    state.cardsFilteredIds = null;
    renderCards();
  }
}


/* ======== Seleção de card / Tabela ======== */
async function selecionarCard(card) {
  state.selectedCard = { id: card.id, type: (card.type||'').toUpperCase(), name: card.name || card.id, benefits: card.benefits || null };
  state.promotionBenefits = null;
  state.paging = { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 };
  destacarCardSelecionado();
  hideLeadingRebateColumnIfPresent();
  applyRebateHeaderTooltip();
  updateSelectedCampaignName();
  await carregarItensPagina(1, true);
}

function qsBuild(params) {
  const entries = Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== '');
  return entries.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
function filtroToStatusParam() {
  switch (state.filtroParticipacao) {
    case 'yes': return 'started';
    case 'non': return 'candidate';
    default: return '';
  }
}

async function carregarItensPagina(pageNumber, reset=false) {
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

    // manter somente a linha do MLB buscado (se houver)
    if (state.mlbFilter) {
      const mlbUp = state.mlbFilter.toUpperCase();
      items = items.filter(x => (x.id || '').toUpperCase() === mlbUp);
    }

    // desconto máximo (%)
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
  }
}

function renderTabela(items) {
  const $body = elTbody();
  if (!items?.length) { $body.innerHTML = `<tr><td colspan="12" class="muted">Nenhum item para esta página.</td></tr>`; return; }

  const benefits = state.promotionBenefits || state.selectedCard?.benefits || null;
  const rebatePctFallback = (benefits?.meli_percent != null) ? Number(benefits.meli_percent) : null;

  const rows = items.map((it) => {
    const mlb  = it.id || '';
    const tit  = it.title || '—';
    const est  = (it.available_quantity ?? it.stock ?? '—');
    const sku  = it.seller_custom_field ?? it.sku ?? '—';

    const original = it.original_price ?? it.price ?? null; // preço cheio
    const deal     = it.deal_price ?? it.price ?? null;     // preço final (se houver)

    let descPct = it.discount_percentage;
    if ((descPct == null) && original && deal && Number(original) > 0) {
      descPct = (1 - (Number(deal)/Number(original))) * 100;
    }

    const rebatePct = (it.rebate_meli_percent != null) ? Number(it.rebate_meli_percent) : rebatePctFallback;
    const novo = (original != null && descPct != null) ? round2(Number(original) * (1 - (Number(descPct)/100))) : null;

    const precoAtual = (original != null) ? fmtMoeda(original) : '—';
    const precoFinal = (deal != null)     ? fmtMoeda(deal)     : '—';
    const novoPreco  = (novo != null)     ? fmtMoeda(novo)     : '—';
    const status     = it.status || '—';
    const rebateCell = (rebatePct != null) ? fmtPerc(rebatePct, 0) : '—';

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

function updateSelectedCampaignName() {
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

function renderPaginacao() {
  const $pag = elPag();
  const total = state.paging.total || 0;
  const pages = total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : state.paging.lastPageKnown;
  const cur   = state.paging.currentPage;
  const isKnown = (p)=> state.paging.tokensByPage[p] !== undefined;

  let html = '';
  html += `<button class="page-btn" ${cur<=1?'disabled':''} onclick="goPage(${cur-1})">‹</button>`;
  for (let p=1; p<=pages; p++) {
    const cls = 'page-btn' + (p===cur?' active':'');
    const dis = isKnown(p) ? '' : 'disabled';
    html += `<button class="${cls}" ${dis} onclick="goPage(${p})">${p}</button>`;
  }
  html += `<button class="page-btn" ${cur>=pages?'disabled':''} onclick="goPage(${cur+1})">›</button>`;
  $pag.innerHTML = html;
}

/* ======== ações (stubs) ======== */
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

/* ======== boot ======== */
document.addEventListener('DOMContentLoaded', async () => {
  hideLeadingRebateColumnIfPresent();
  updateSelectedCampaignName();
  await carregarCards();
});
