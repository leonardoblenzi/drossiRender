// public/js/excluir-anuncio.js
(() => {
  const $ = (s) => document.querySelector(s);

  // Campos e botões
  const inputSingle = $('#mlb-id');
  const inputLote = $('#mlb-list');
  const btnExcluir = $('#btn-excluir');
  const btnLote = $('#btn-excluir-lote');
  const btnLimpar = $('#btn-limpar');
  const painel = $('#result-panel');
  const pre = $('#result-json');

  // Modal de confirmação
  const modalConfirm = $('#modal-confirm-exclusao');
  const confirmText = $('#confirm-excluir-text');
  const btnConfirmSim = $('#confirm-excluir-sim');
  const btnConfirmNao = $('#confirm-excluir-nao');
  const btnConfirmClose = $('#confirm-excluir-close');

  // Qual ação está pendente de confirmação? 'single' | 'lote' | null
  let pendingAction = null;
  let pendingCount = 0;

  function showResult(data) {
    if (!painel || !pre) return;
    pre.textContent = JSON.stringify(data, null, 2);
    painel.classList.remove('hidden');
  }

  function limparTudo() {
    if (inputSingle) inputSingle.value = '';
    if (inputLote) inputLote.value = '';
    if (painel && pre) {
      painel.classList.add('hidden');
      pre.textContent = '{}';
    }
  }

  // ========= MODAL DE CONFIRMAÇÃO =========

  function abrirModalConfirmacao(tipo, extra = {}) {
    pendingAction = tipo;
    pendingCount = extra.count || 0;

    if (confirmText) {
      if (tipo === 'single') {
        confirmText.textContent =
          'Tem certeza que deseja iniciar o processo de exclusão deste anúncio?';
      } else if (tipo === 'lote') {
        if (pendingCount > 0) {
          confirmText.textContent =
            `Tem certeza que deseja iniciar o processo de exclusão de ${pendingCount} anúncios?`;
        } else {
          confirmText.textContent =
            'Tem certeza que deseja iniciar o processo de exclusão de anúncios?';
        }
      } else {
        confirmText.textContent =
          'Tem certeza que deseja iniciar o processo de exclusão de anúncios?';
      }
    }

    if (modalConfirm) {
      modalConfirm.style.display = 'block';
    }
  }

  function fecharModalConfirmacao() {
    if (modalConfirm) {
      modalConfirm.style.display = 'none';
    }
    pendingAction = null;
    pendingCount = 0;
  }

  // Clique em "Sim"
  btnConfirmSim?.addEventListener('click', () => {
    const action = pendingAction;
    fecharModalConfirmacao();

    if (action === 'single') {
      excluirUnico();
    } else if (action === 'lote') {
      excluirLote();
    }
  });

  // Clique em "Não" ou no X
  [btnConfirmNao, btnConfirmClose].forEach((btn) => {
    btn?.addEventListener('click', () => {
      fecharModalConfirmacao();
    });
  });

  // Fechar clicando fora do modal
  window.addEventListener('click', (ev) => {
    if (ev.target === modalConfirm) {
      fecharModalConfirmacao();
    }
  });

  // ========= AÇÕES PRINCIPAIS =========

  async function excluirUnico() {
    const mlb = (inputSingle?.value || '').trim().toUpperCase();
    if (!mlb || !/^MLB\d{5,}$/.test(mlb)) {
      alert('Informe um código MLB válido');
      return;
    }

    try {
      const resp = await fetch(`/anuncios/excluir/${mlb}`, { method: 'DELETE' });
      const json = await resp.json();
      showResult(json);
    } catch (err) {
      showResult({ error: true, message: err.message });
    }
  }

  async function excluirLote() {
    const lista = (inputLote?.value || '')
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!lista.length) {
      alert('Cole ao menos 1 MLB para excluir');
      return;
    }

    try {
      // Usa o orquestrador de fila da exclusão
      if (!window.ExclusaoBulk || typeof window.ExclusaoBulk.enqueue !== 'function') {
        throw new Error('Exclusão em lote (ExclusaoBulk) não está disponível nesta página.');
      }

      await window.ExclusaoBulk.enqueue({
        items: lista,
        delayMs: 250,
        title: `Exclusão em lote (${lista.length})`,
      });

      showResult({
        ok: true,
        message:
          'Enviado para processamento em segundo plano. Acompanhe o progresso no painel de processos (canto inferior direito).',
        total_ids: lista.length,
      });
    } catch (err) {
      showResult({ error: true, message: err.message });
    }
  }

  // ========= BIND DOS BOTÕES =========

  // Agora os botões NÃO chamam direto as funções;
  // primeiro perguntam no modal de confirmação.

  btnExcluir?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const mlb = (inputSingle?.value || '').trim().toUpperCase();
    if (!mlb || !/^MLB\d{5,}$/.test(mlb)) {
      alert('Informe um código MLB válido');
      return;
    }
    abrirModalConfirmacao('single');
  });

  btnLote?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const lista = (inputLote?.value || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!lista.length) {
      alert('Cole ao menos 1 MLB para excluir');
      return;
    }
    abrirModalConfirmacao('lote', { count: lista.length });
  });

  btnLimpar?.addEventListener('click', (ev) => {
    ev.preventDefault();
    limparTudo();
  });
})();
