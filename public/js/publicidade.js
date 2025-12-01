// public/js/publicidade.js
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  let campanhasOriginais = [];

  /* ===== Conta atual (mesmo padrão do dashboard) ===== */
  const ACCOUNT_LABELS = {
    drossi: 'DRossi Interiores',
    diplany: 'Diplany',
    rossidecor: 'Rossi Decor'
  };

  async function carregarContaAtual() {
    const currentEl = $('account-current');
    try {
      const r = await fetch('/api/account/current', { cache: 'no-store' });
      const data = await r.json();
      let shown = 'Não selecionada';
      if (data && (data.ok || data.success)) {
        shown = data.label || ACCOUNT_LABELS[data.accountKey] || data.accountKey || 'Desconhecida';
      }
      if (currentEl) currentEl.textContent = shown;
    } catch (e) {
      if (currentEl) currentEl.textContent = 'Indisponível';
      console.error('carregarContaAtual:', e);
    }
  }

  async function trocarConta() {
    try {
      await fetch('/api/account/clear', { method: 'POST' });
    } catch (_) { /* ignore */ }
    window.location.href = '/select-conta';
  }

  /* ===== Status / Token (atalho simples) ===== */
  async function verificarToken() {
    try {
      const r = await fetch('/verificar-token');
      const data = await r.json();
      alert(data.message || 'OK');
    } catch (e) {
      alert('Erro ao verificar token: ' + e.message);
    }
  }

  function bindHeaderButtons() {
    const btnStatus = $('btn-status');
    const btnSwitch = $('account-switch');
    if (btnStatus) btnStatus.addEventListener('click', verificarToken);
    if (btnSwitch) btnSwitch.addEventListener('click', trocarConta);
  }

  /* ===== Fetch de campanhas ===== */
  async function carregarCampanhas() {
    const resumoEl = $('campanhas-resumo');
    const tbody = $('tbody-campanhas');
    const empty = $('campanhas-empty');

    if (resumoEl) resumoEl.textContent = 'Carregando campanhas...';
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'none';

    try {
      const params = new URLSearchParams();
      params.set('periodo_dias', $('f-periodo')?.value || '30');
      params.set('status', $('f-status-campanha')?.value || 'todas');

      const r = await fetch(`/api/publicidade/product-ads/campanhas?${params.toString()}`, {
        cache: 'no-store'
      });

      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }

      const data = await r.json();
      const lista = data.campanhas || data.data || [];

      campanhasOriginais = lista;
      aplicarFiltrosEAtualizar();

      if (resumoEl) {
        resumoEl.textContent = `${lista.length} campanha(s) carregadas`;
      }
    } catch (e) {
      console.error('carregarCampanhas:', e);
      if (resumoEl) {
        resumoEl.textContent = 'Erro ao carregar campanhas. Verifique se o endpoint está configurado.';
      }
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'Não foi possível carregar as campanhas (endpoint não disponível).';
      }
    }
  }

  /* ===== Filtros no front ===== */
  function aplicarFiltrosEAtualizar() {
    const busca = ($('f-busca')?.value || '').toLowerCase().trim();
    const ordenarPorVariacao = $('f-ordenar-variacao')?.checked;

    let lista = [...campanhasOriginais];

    if (busca) {
      lista = lista.filter((c) =>
        String(c.nome || c.name || '')
          .toLowerCase()
          .includes(busca)
      );
    }

    // exemplo simples de ordenação – depois podemos trocar por variação real
    if (ordenarPorVariacao) {
      lista.sort((a, b) => {
        const va = Number(a.variacao ?? 0);
        const vb = Number(b.variacao ?? 0);
        return vb - va;
      });
    }

    renderTabela(lista);
  }

  /* ===== Renderização da tabela ===== */
  function formatMoney(v) {
    const n = Number(v || 0);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatPct(v) {
    const n = Number(v || 0);
    return `${n.toFixed(2).replace('.', ',')} %`;
  }

  function renderTabela(lista) {
    const tbody = $('tbody-campanhas');
    const empty = $('campanhas-empty');
    if (!tbody) return;

    if (!lista || lista.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    tbody.innerHTML = lista
      .map((c) => {
        const id = c.id || c.campaign_id || '';
        const nome = c.nome || c.name || '(sem nome)';
        const status = (c.status || 'ativa').toLowerCase();

        const statusClass =
          status === 'paused' || status === 'pausada'
            ? 'badge-pill--status-pausada'
            : status === 'closed' || status === 'encerrada'
            ? 'badge-pill--status-encerrada'
            : 'badge-pill--status-ativa';

        return `
        <tr data-id="${id}">
          <td class="col-nome">
            <div class="campanha-nome" data-id="${id}">
              ${nome}
            </div>
            <div class="campanha-meta">
              ${c.adgroups_count ? `${c.adgroups_count} adgroups • ` : ''}
              ${c.data_criacao ?? c.created_at ?? ''}
              ${status ? `<span class="badge-pill ${statusClass}">${status}</span>` : ''}
            </div>
          </td>
          <td>${c.competitividade ?? '-'}</td>
          <td>${c.orcamento_mensal != null ? formatMoney(c.orcamento_mensal) : '-'}</td>
          <td>${c.orcamento_diario_disp != null ? formatMoney(c.orcamento_diario_disp) : '-'}</td>
          <td>${c.acos_objetivo != null ? formatPct(c.acos_objetivo) : '-'}</td>
          <td>${c.acos != null ? formatPct(c.acos) : '-'}</td>
          <td>${c.tacos != null ? formatPct(c.tacos) : '-'}</td>
          <td>${c.cpi != null ? formatPct(c.cpi) : '-'}</td>
          <td>${c.lisb != null ? formatPct(c.lisb) : '-'}</td>
          <td>${c.lisar != null ? formatPct(c.lisar) : '-'}</td>
          <td>${c.participacao != null ? formatPct(c.participacao) : '-'}</td>
          <td>${c.vendas_publicidade ?? '-'}</td>
          <td>${c.impressoes ?? '-'}</td>
          <td>${c.cliques ?? '-'}</td>
          <td>${c.investimento != null ? formatMoney(c.investimento) : '-'}</td>
          <td>${c.cpc != null ? formatMoney(c.cpc) : '-'}</td>
          <td>${c.ctr != null ? formatPct(c.ctr) : '-'}</td>
          <td>${c.receita != null ? formatMoney(c.receita) : '-'}</td>
          <td>${c.retornos ?? '-'}</td>
          <td class="col-acoes">
            <div class="table-actions">
              <button class="btn-link btn-ver-detalhes" data-id="${id}">Ver detalhes</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    // bind nos nomes / botões
    qsa('.campanha-nome').forEach((el) => {
      el.addEventListener('click', () => abrirDetalheCampanha(el.dataset.id));
    });
    qsa('.btn-ver-detalhes').forEach((el) => {
      el.addEventListener('click', () => abrirDetalheCampanha(el.dataset.id));
    });
  }

  /* ===== Detalhe da campanha (outra página) ===== */
  function abrirDetalheCampanha(id) {
    if (!id) return;
    // rota que vamos criar depois (Product Ads - detalhe)
    window.location.href = `/publicidade/campanha/${encodeURIComponent(id)}`;
  }

  /* ===== Exportar CSV ===== */
  async function exportarCampanhasCSV() {
    try {
      const params = new URLSearchParams();
      params.set('periodo_dias', $('f-periodo')?.value || '30');
      params.set('status', $('f-status-campanha')?.value || 'todas');

      // endpoint a implementar no backend
      window.location.href = `/api/publicidade/product-ads/campanhas/csv?${params.toString()}`;
    } catch (e) {
      alert('Erro ao exportar CSV: ' + e.message);
    }
  }

  /* ===== Filtros: binds ===== */
  function bindFiltros() {
    const btnAplicar = $('btn-aplicar-filtros');
    const btnLimpar = $('btn-limpar-filtros');
    const inputBusca = $('f-busca');
    const chkVariacao = $('f-ordenar-variacao');
    const btnExport = $('btn-export-campanhas');

    if (btnAplicar) btnAplicar.addEventListener('click', carregarCampanhas);
    if (btnLimpar)
      btnLimpar.addEventListener('click', () => {
        if ($('f-periodo')) $('f-periodo').value = '30';
        if ($('f-status-campanha')) $('f-status-campanha').value = 'todas';
        if (inputBusca) inputBusca.value = '';
        if (chkVariacao) chkVariacao.checked = false;
        aplicarFiltrosEAtualizar();
      });

    if (inputBusca) {
      inputBusca.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') aplicarFiltrosEAtualizar();
      });
      inputBusca.addEventListener('input', () => {
        // filtro em tempo real
        aplicarFiltrosEAtualizar();
      });
    }

    if (chkVariacao) {
      chkVariacao.addEventListener('change', aplicarFiltrosEAtualizar);
    }

    if (btnExport) {
      btnExport.addEventListener('click', exportarCampanhasCSV);
    }
  }

  /* ===== Boot ===== */
  document.addEventListener('DOMContentLoaded', () => {
    try {
      bindHeaderButtons();
      bindFiltros();
      carregarContaAtual();
      carregarCampanhas();
    } catch (e) {
      console.error('Erro na inicialização da página Publicidade:', e);
    }
  });
})();
