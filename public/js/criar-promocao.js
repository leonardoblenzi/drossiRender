// public/js/criar-promocao.js
console.log('🚀 criar-promocao.js carregado');

// ------- helpers
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
const getJSON = (p)=>getJSONAny([p]);

// ------- endpoints (mantém aliases p/ compat)
const usersPaths = () => [
  '/api/promocoes/users',
  '/api/promocao/users',
  '/api/promotions/users',
];
const itemsPaths = (promotionId, type, qs) => {
  const suffix = `?promotion_type=${encodeURIComponent(type)}${qs ? `&${qs}` : ''}`;
  const pid = encodeURIComponent(promotionId);
  return [
    `/api/promocoes/promotions/${pid}/items${suffix}`, // canônico
    `/api/promocao/promotions/${pid}/items${suffix}`,  // alias
    `/api/promotions/promotions/${pid}/items${suffix}` // alias
  ];
};

const PAGE_SIZE = 50;
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

const state = {
  cards: [],
  items: [],
  selectedCard: null,
  filtroParticipacao: 'all',
  paging: { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 },
};

function esc (s){ return (s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))); }
const fmtMoeda = (n)=> (n==null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const fmtPerc  = (n,d=2)=> (n||n===0)?`${Number(n).toFixed(d)}%`:'—';

function elCards(){ return document.getElementById('cards'); }
function elTbody(){ return document.getElementById('tbody'); }
function elPag(){ return document.getElementById('paginacao'); }

// -------- UI
async function carregarCards() {
  const $cards = elCards();
  $cards.innerHTML = `<div class="card"><h3>Carregando promoções…</h3><div class="muted">Aguarde</div></div>`;
  try {
    const data = await getJSONAny(usersPaths());
    state.cards = Array.isArray(data.results) ? data.results : [];

    if (!state.cards.length) {
      $cards.innerHTML = `<div class="card"><h3>Nenhuma promoção disponível</h3><div class="muted">Esta conta não possui convites no momento.</div></div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const c of state.cards) {
      const div = document.createElement('div');
      div.className = 'card';
      div.tabIndex = 0;
      const status = (c.status || '').toLowerCase();
      const pill = status === 'started' ? '<span class="pill">started</span>' : `<span class="pill muted">${esc(c.status || '')}</span>`;
      const fini = c.finish_date ? new Date(c.finish_date).toLocaleDateString('pt-BR') : '';
      const benefits = c.benefits ? `<div class="muted" style="margin-top:4px">Rebate MELI: ${c.benefits.meli_percent ?? '—'}% • Seller: ${c.benefits.seller_percent ?? '—'}%</div>` : '';

      div.innerHTML = `<h3>${esc(c.name || c.id || 'Campanha')}</h3>
        <div class="muted">${esc(c.type || '')} ${pill}</div>
        <div class="muted">${fini ? 'Até ' + fini : ''}</div>
        ${benefits}`;
      div.addEventListener('click', () => selecionarCard(c));
      frag.appendChild(div);
    }
    $cards.innerHTML = '';
    $cards.appendChild(frag);
  } catch (e) {
    const authMsg = (e?.cause?.status === 401 || e?.cause?.status === 403)
      ? 'Sua sessão com o Mercado Livre expirou ou não é de usuário. Clique em “Trocar Conta” e reconecte.'
      : 'Não foi possível carregar promoções (ver console).';
    $cards.innerHTML = `<div class="card"><h3>Falha</h3><pre class="muted">${esc(authMsg)}</pre></div>`;
  }
}

function destacarCardSelecionado() {
  const $cards = elCards();
  [...$cards.children].forEach(n => n.classList.remove('card--active'));
  const idx = state.cards.findIndex(c => c.id === state.selectedCard?.id);
  if (idx >= 0 && $cards.children[idx]) $cards.children[idx].classList.add('card--active');
}

async function selecionarCard(card) {
  state.selectedCard = { id: card.id, type: card.type, name: card.name || card.id, benefits: card.benefits || null };
  state.paging = { total:0, limit:PAGE_SIZE, tokensByPage:{1:null}, currentPage:1, lastPageKnown:1 };
  destacarCardSelecionado();
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
    // "descobrir" tokens até chegar à página desejada
    while (!haveToken) {
      const prev = state.paging.lastPageKnown;
      const prevToken = state.paging.tokensByPage[prev] ?? null;
      const qs = qsBuild({ limit: PAGE_SIZE, status: filtroToStatusParam(), ...(prevToken ? { search_after: prevToken } : {}) });
      const data = await getJSONAny(itemsPaths(state.selectedCard.id, state.selectedCard.type, qs));
      const nextToken = data?.paging?.searchAfter || null;
      const total = data?.paging?.total ?? 0;
      state.paging.total = total;
      state.paging.tokensByPage[prev+1] = nextToken;
      state.paging.lastPageKnown = prev+1;
      haveToken = state.paging.tokensByPage[targetPage] !== undefined;
      if (!nextToken) break;
    }

    const token = state.paging.tokensByPage[targetPage] ?? null;
    const qs = qsBuild({ limit: PAGE_SIZE, status: filtroToStatusParam(), ...(token ? { search_after: token } : {}) });
    const data = await getJSONAny(itemsPaths(state.selectedCard.id, state.selectedCard.type, qs));
    state.items = Array.isArray(data.results) ? data.results : [];
    state.paging.total = data?.paging?.total ?? state.paging.total;
    state.paging.currentPage = targetPage;

    renderTabela(state.items);
    renderPaginacao();
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

  const rows = items.map((it) => {
    const mlb  = it.id || '';
    const tit  = it.title || '—';
    const est  = (it.available_quantity ?? it.stock ?? '—');
    const sku  = it.seller_custom_field ?? it.sku ?? '—';
    const original = it.original_price ?? it.price ?? null;
    const deal     = it.deal_price ?? it.price ?? null;
    const topDeal  = it.top_deal_price ?? null;

    let descCamp = '—';
    if (it.discount_percentage != null) descCamp = fmtPerc(it.discount_percentage);
    else if (original && deal && Number(original) > 0) descCamp = fmtPerc(100*(1-(Number(deal)/Number(original))));

    const precoFinal = deal ? fmtMoeda(deal) : '—';
    const precoAtual = original ? fmtMoeda(original) : '—';
    const novoPreco  = topDeal ? fmtMoeda(topDeal) : '—';
    const status     = it.status || '—';

    return `<tr>
      <td><input type="checkbox" data-mlb="${esc(mlb)}"></td>
      <td>${esc(mlb)}</td>
      <td>${esc(tit)}</td>
      <td>${esc(est)}</td>
      <td>${esc(sku)}</td>
      <td>${precoAtual}</td>
      <td>${esc(descCamp)}</td>
      <td>${precoFinal}</td>
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

async function goPage(n){ if (!n || n===state.paging.currentPage) return; await carregarItensPagina(n,false); }
function aplicarFiltro(){
  const val = ($$('input[name="filtro"]').find(r=>r.checked)?.value) || 'all';
  state.filtroParticipacao = val;
  if (state.selectedCard) carregarItensPagina(1, true);
}
function toggleTodos(master){ $$('#tbody input[type="checkbox"][data-mlb]').forEach(ch=>ch.checked=master.checked); }
function buscarItem(){
  const v = document.getElementById('mlbInput')?.value?.trim(); if (!v) return;
  $$('#tbody tr').forEach(tr => { const has = tr.querySelector(`[data-mlb="${v}"]`); tr.style.display = has ? '' : 'none'; });
}
function atualizarPreview(){
  const pct = Number(document.getElementById('percent')?.value || 0);
  if (!pct || !state.items.length) return;
  state.items.forEach((it, idx) => {
    const original = it.original_price ?? it.price;
    const novo     = (original && pct>0) ? (Number(original) * (1 - pct/100)) : null;
    const row = elTbody().rows[idx]; if (!row) return;
    const novoTd = row.cells[8]; if (novoTd) novoTd.textContent = novo ? fmtMoeda(novo) : '—';
  });
}
function aplicarLoteSelecionados(){
  const pct = Number(document.getElementById('percent')?.value || 0);
  const sel = $$('#tbody input[type="checkbox"][data-mlb]:checked').map(el=>el.dataset.mlb);
  if (!sel.length) { alert('Selecione ao menos 1 item'); return; }
  alert(`(stub) Aplicar ${pct}% em ${sel.length} itens na promoção ${state.selectedCard?.id || ''}`);
}
function removerUnicoDaCampanha(mlb){ alert(`(stub) Remover ${mlb} da campanha ${state.selectedCard?.id || ''}`); }
function aplicarUnico(mlb){ const pct = Number(document.getElementById('percent')?.value || 0); alert(`(stub) Aplicar ${pct}% no ${mlb} em ${state.selectedCard?.id || ''}`); }
function limparTudo(){
  (document.getElementById('mlbsLista')||{}).value = '';
  (document.getElementById('mlbInput')||{}).value = '';
  (document.getElementById('percent')||{}).value = '';
  $$('#tbody tr').forEach(tr=>tr.style.display='');
}

window.goPage = goPage;
window.aplicarFiltro = aplicarFiltro;
window.toggleTodos = toggleTodos;
window.buscarItem = buscarItem;
window.atualizarPreview = atualizarPreview;
window.aplicarLoteSelecionados = aplicarLoteSelecionados;
window.removerUnicoDaCampanha = removerUnicoDaCampanha;
window.aplicarUnico = aplicarUnico;
window.limparTudo = limparTudo;

document.addEventListener('DOMContentLoaded', async () => {
  await carregarCards();
  aplicarFiltro();
});
