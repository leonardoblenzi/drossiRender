// public/js/excluir-anuncio.js
(() => {
  const $ = (s) => document.querySelector(s);

  const inputSingle = $('#mlb-id');
  const inputLote   = $('#mlb-list');
  const btnExcluir  = $('#btn-excluir');
  const btnLote     = $('#btn-excluir-lote');
  const btnLimpar   = $('#btn-limpar');
  const painel      = $('#result-panel');
  const pre         = $('#result-json');

  function showResult(data) {
    if (!painel || !pre) return;
    pre.textContent = JSON.stringify(data, null, 2);
    painel.classList.remove('hidden');
  }

  function limparTudo() {
    if (inputSingle) inputSingle.value = '';
    if (inputLote)   inputLote.value   = '';
    if (painel && pre) {
      painel.classList.add('hidden');
      pre.textContent = '{}';
    }
  }

  async function excluirUnico() {
    const mlb = (inputSingle?.value || '').trim().toUpperCase();
    if (!mlb || !/^MLB\d{5,}$/.test(mlb)) {
      alert('Informe um código MLB válido (ex: MLB123456789)');
      return;
    }

    try {
      const resp = await fetch(`/anuncios/excluir/${mlb}`, { method: 'DELETE' });
      const json = await resp.json();
      showResult(json);
    } catch (err) {
      console.error('Erro ao excluir anúncio único:', err);
      showResult({ error: true, message: err.message });
    }
  }

  async function excluirLote() {
    const lista = (inputLote?.value || '')
      .split(/\r?\n/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (!lista.length) {
      alert('Cole ao menos 1 MLB para excluir (um por linha).');
      return;
    }

    try {
      if (!window.ExclusaoBulk || typeof window.ExclusaoBulk.enqueue !== 'function') {
        throw new Error('Fila de exclusão (ExclusaoBulk) não disponível na página.');
      }

      await window.ExclusaoBulk.enqueue({
        items: lista,
        delayMs: 250,
        title: `Exclusão em lote (${lista.length})`
      });

      showResult({
        ok: true,
        message: '🚀 Processo enviado para execução em segundo plano. Acompanhe no painel de processos (canto inferior direito).'
      });
    } catch (err) {
      console.error('Erro ao enfileirar exclusão em lote:', err);
      showResult({ error: true, message: err.message });
    }
  }

  btnExcluir?.addEventListener('click', excluirUnico);
  btnLote?.addEventListener('click', excluirLote);
  btnLimpar?.addEventListener('click', limparTudo);
})();
