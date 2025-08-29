// public/js/promo-bulk.js
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s)=> (s==null?'':String(s));

  const ui = {
    wrap:   null,
    btnSel: null,
    btnApp: null,
    btnRem: null,
  };

  const ctx = {
    promotion_id: null,
    promotion_type: null,
    headerChecked: false,
  };

  function ensureUI(){
    if (ui.wrap) return;
    ui.wrap = document.getElementById('bulkControls');
    ui.btnSel = document.getElementById('bulkSelectAllBtn');
    ui.btnApp = document.getElementById('bulkApplyAllBtn');
    ui.btnRem = document.getElementById('bulkRemoveAllBtn');

    if (!ui.wrap || !ui.btnSel || !ui.btnApp || !ui.btnRem) return;

    ui.btnSel.addEventListener('click', onSelectAllClick);
    ui.btnApp.addEventListener('click', onApplyAllClick);
    ui.btnRem.addEventListener('click', onRemoveAllClick);
  }

  function countVisible(){
    return $$('#tbody input[type="checkbox"][data-mlb]').length;
  }
  function countSelected(){
    return $$('#tbody input[type="checkbox"][data-mlb]:checked').length;
  }
  function getSelectedMLBs(){
    return $$('#tbody input[type="checkbox"][data-mlb]:checked').map(x => x.dataset.mlb);
  }

  function render(){
    ensureUI();
    if (!ui.wrap) return;

    const totalVisiveis = countVisible();
    const totalSel = countSelected();

    if (!ctx.headerChecked || totalVisiveis === 0) {
      ui.wrap.classList.add('hidden');
      return;
    }

    ui.wrap.classList.remove('hidden');
    ui.btnSel.textContent = `Selecionar todos (${totalVisiveis} exibidos)`;
    ui.btnApp.disabled = totalSel === 0;
    ui.btnRem.disabled = totalSel === 0;
  }

  function onSelectAllClick(){
    // marca todos os checkboxes visíveis (já é feito pelo toggle do cabeçalho, mas reforçamos)
    $$('#tbody input[type="checkbox"][data-mlb]').forEach(ch => ch.checked = true);
    render();
  }

  async function onApplyAllClick(){
    if (!window.aplicarUnico) return alert('Função aplicarUnico não encontrada.');
    const mlbs = getSelectedMLBs();
    if (!mlbs.length) return;

    // TODO (fase 2): aqui podemos disparar uma preparação no servidor para pegar "todos os filtrados" (todas as páginas)
    // e enfileirar no Redis. Por enquanto aplicamos somente os visíveis/selecionados.
    ui.btnApp.disabled = true;
    for (const id of mlbs) {
      try { // aplica em série
        // mesma API de item único já existente
        await window.aplicarUnico(id);
      } catch(e) {
        console.warn('[bulk] falha aplicar', id, e);
      }
    }
    ui.btnApp.disabled = false;
  }

  async function onRemoveAllClick(){
    alert('(stub) Remover em massa — plugaremos aqui quando a rota de remoção em lote estiver pronta.');
  }

  // API pública usada pelo criar-promocao.js
  window.PromoBulk = {
    setContext({ promotion_id, promotion_type }){
      ctx.promotion_id = promotion_id;
      ctx.promotion_type = promotion_type;
      render();
    },
    onHeaderToggle(checked){
      ctx.headerChecked = !!checked;
      render();
    }
  };

  // re-render quando os checkboxes de linha mudarem
  document.addEventListener('change', (ev) => {
    if (ev.target?.matches?.('#tbody input[type="checkbox"][data-mlb]')) {
      render();
    }
  });

  // re-render em paginação/conteúdo novo
  const obs = new MutationObserver(render);
  obs.observe(document.getElementById('tbody'), { childList: true, subtree: false });

  // primeira pintura (caso a página já tenha itens)
  document.addEventListener('DOMContentLoaded', render);
})();
