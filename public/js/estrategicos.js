// public/js/estrategicos.js
// Tela de Produtos Estratégicos

(() => {
  'use strict';

  // =========================
  // Helpers básicos
  // =========================
  const $  = (id) => document.getElementById(id);
  const qs = (sel, el = document) => el.querySelector(sel);

  const formatPercent = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return '';
    return (
      n.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + '%'
    );
  };

  const toast = (msg) => {
    try {
      alert(msg);
    } catch {
      console.log('ALERT:', msg);
    }
  };

  async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!resp.ok) {
      let extra = '';
      try {
        const txt = await resp.text();
        extra = txt;
      } catch (_) {}
      throw new Error(`HTTP ${resp.status} em ${url} ${extra || ''}`.trim());
    }
    try {
      return await resp.json();
    } catch {
      return null;
    }
  }

  // =========================
  // Estado em memória
  // =========================
  let rows = [];               // lista de produtos estratégicos
  let currentGroup = 'drossi'; // valor do select (UX)

  // Paginação
  const PAGE_SIZE = 20;
  let currentPage = 1;

  // Estrutura esperada de cada item:
  // {
  //   mlb: 'MLB123',
  //   name: 'Nome do produto',
  //   percent_default: 19,
  //   percent_applied: 19,
  //   status: 'ok' | 'pendente' | 'erro'
  // }

  // =========================
  // Carregar lista do backend
  // =========================
  async function loadRows() {
    const tbody = $('tbodyStrategicos');
    const summaryTotal = $('summaryTotal');
    const summarySelected = $('summarySelected');

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted">
            Carregando produtos estratégicos...
          </td>
        </tr>
      `;
    }

    try {
      // se você quiser já mandar o group:
      // const data = await fetchJSON(`/api/estrategicos?group=${encodeURIComponent(currentGroup)}`, { method: 'GET' });
      const data = await fetchJSON('/api/estrategicos', { method: 'GET' });

      rows = Array.isArray(data?.items || data)
        ? (data.items || data)
        : [];

      currentPage = 1; // sempre volta pra página 1 ao recarregar
      renderTable();

      if (summaryTotal)    summaryTotal.textContent    = `${rows.length} itens`;
      if (summarySelected) summarySelected.textContent = `0 selecionados`;
    } catch (err) {
      console.error('loadRows:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="muted">
              Erro ao carregar produtos estratégicos: ${err.message}
            </td>
          </tr>
        `;
      }
      renderPagination(); // limpa paginador em caso de erro
    }
  }

  // =========================
  // Util: pegar selecionados
  // =========================
  function getSelectedMlbs() {
    const tbody = $('tbodyStrategicos');
    if (!tbody) return [];
    const checks = tbody.querySelectorAll('.row-select:checked');
    return Array.from(checks)
      .map((c) => c.getAttribute('data-mlb'))
      .filter(Boolean);
  }

  function updateSummarySelected() {
    const summarySelected = $('summarySelected');
    if (!summarySelected) return;
    summarySelected.textContent = `${getSelectedMlbs().length} selecionados`;
  }

  // =========================
  // Paginação (render)
  // =========================
  function renderPagination() {
    const container = $('strategicPagination');
    if (!container) return;

    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    if (currentPage > totalPages) currentPage = totalPages;

    let html = '';

    // botão anterior
    html += `
      <button type="button"
              class="pg-btn pg-prev"
              data-page="prev"
              ${currentPage === 1 ? 'disabled' : ''}>
        &laquo;
      </button>
    `;

    // páginas numeradas
    for (let p = 1; p <= totalPages; p++) {
      html += `
        <button type="button"
                class="pg-btn pg-num ${p === currentPage ? 'is-active' : ''}"
                data-page="${p}">
          ${p}
        </button>
      `;
    }

    // botão próximo
    html += `
      <button type="button"
              class="pg-btn pg-next"
              data-page="next"
              ${currentPage === totalPages ? 'disabled' : ''}>
        &raquo;
      </button>
    `;

    container.innerHTML = html;
  }

  // =========================
  // Renderização da tabela
  // =========================
  function renderTable() {
    const tbody = $('tbodyStrategicos');
    const summaryTotal = $('summaryTotal');
    const chkAll = $('chkSelectAllRows');

    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted">
            Nenhum produto estratégico cadastrado. Use <strong>“Adicionar item”</strong> ou
            <strong>“Atualizar por arquivo”</strong>.
          </td>
        </tr>
      `;
      if (summaryTotal) summaryTotal.textContent = '0 itens';
      if (chkAll) chkAll.checked = false;
      renderPagination();
      updateSummarySelected();
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(startIdx, startIdx + PAGE_SIZE);

    const html = pageRows.map((row) => {
      const mlb = row.mlb || '';
      const name = row.name || row.nome || '';
      const pDef = row.percent_default ?? row.percent_padrao;
      const pApplied = row.percent_applied ?? row.percent_aplicada;

      let statusLabel = '—';
      let statusClass = 'status-pill--default';
      const s = (row.status || '').toLowerCase();
      if (s === 'ok' || s === 'ativo' || s === 'promoção aplicada') {
        statusLabel = 'OK';
        statusClass = 'status-pill--ok';
      } else if (s === 'erro' || s === 'falha') {
        statusLabel = 'Erro';
        statusClass = 'status-pill--error';
      } else if (s === 'pendente' || s === 'novo') {
        statusLabel = 'Pendente';
        statusClass = 'status-pill--pending';
      }

      return `
        <tr data-mlb="${mlb}">
          <td class="col-check">
            <input type="checkbox" class="row-select" data-mlb="${mlb}">
          </td>
          <td class="col-mlb">
            <span class="mlb-label">${mlb}</span>
          </td>
          <td class="col-name">
            <input
              type="text"
              class="input-name"
              data-field="name"
              value="${name.replace(/"/g, '&quot;')}"
              placeholder="Opcional"
            >
          </td>
          <td class="col-percent">
            <input
              type="number"
              class="input-percent"
              data-field="percent_default"
              min="0"
              max="90"
              step="0.1"
              value="${pDef ?? ''}"
              placeholder="-"
            >
          </td>
          <td class="col-percent col-applied">
            ${
              pApplied != null &&
              pApplied !== '' &&
              !Number.isNaN(Number(pApplied))
                ? `<span class="percent-applied-label">${formatPercent(pApplied)}</span>`
                : '<span class="muted">—</span>'
            }
          </td>
          <td class="col-status">
            <span class="status-pill ${statusClass}">${statusLabel}</span>
          </td>
          <td class="col-actions">
            <button type="button" class="btn-xs btn-outline" data-action="save-row">
              💾 Salvar
            </button>
            <button type="button" class="btn-xs btn-danger" data-action="delete-row">
              🗑️
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = html;

    if (summaryTotal) {
      summaryTotal.textContent = `${rows.length} itens`;
    }
    if (chkAll) {
      chkAll.checked = false;
    }

    renderPagination();
    updateSummarySelected();
  }

  // =========================
  // Persistência: salvar 1 item
  // =========================
  async function saveRow(mlb) {
    const row = rows.find((r) => String(r.mlb) === String(mlb));
    if (!row) return;

    try {
      const payload = {
        mlb: row.mlb,
        name: row.name || row.nome || '',
        percent_default: row.percent_default ?? row.percent_padrao ?? null,
      };

      await fetchJSON('/api/estrategicos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      toast(`✅ Produto ${mlb} salvo com sucesso.`);
      await loadRows(); // recarrega já com nome/% aplicada do backend
    } catch (err) {
      console.error('saveRow:', err);
      toast(`❌ Erro ao salvar ${mlb}: ${err.message}`);
    }
  }

  // =========================
  // Remover item (individual)
  // =========================
  async function deleteRow(mlb) {
    if (!confirm(`Deseja realmente remover o MLB ${mlb} da lista de estratégicos?`)) {
      return;
    }
    try {
      await fetchJSON(`/api/estrategicos/${encodeURIComponent(mlb)}`, {
        method: 'DELETE',
      });
      rows = rows.filter((r) => String(r.mlb) !== String(mlb));
      renderTable();
    } catch (err) {
      console.error('deleteRow:', err);
      toast(`❌ Erro ao remover ${mlb}: ${err.message}`);
    }
  }

  // =========================
  // Remover itens selecionados
  // =========================
  async function handleDeleteSelected() {
    const selected = getSelectedMlbs();
    if (!selected.length) {
      toast('Selecione ao menos um item para excluir.');
      return;
    }

    if (!confirm(`Remover ${selected.length} item(ns) da lista de estratégicos?`)) {
      return;
    }

    let ok = 0;
    let errCount = 0;

    try {
      for (const mlb of selected) {
        try {
          await fetchJSON(`/api/estrategicos/${encodeURIComponent(mlb)}`, {
            method: 'DELETE',
          });
          ok += 1;
        } catch (err) {
          console.error('Erro ao excluir', mlb, err);
          errCount += 1;
        }
      }

      rows = rows.filter((r) => !selected.includes(String(r.mlb)));
      renderTable();

      let msg = `✅ ${ok} item(ns) removidos.`;
      if (errCount > 0) msg += ` ❗ ${errCount} falharam (veja o console).`;
      toast(msg);
    } catch (err) {
      console.error('handleDeleteSelected:', err);
      toast(`❌ Erro ao excluir selecionados: ${err.message}`);
    }
  }

  // =========================
  // Adicionar item(s) via painel de lote
  // =========================
  function openAddMlbsPanel() {
    const panel = $('addMlbsPanel');
    const textarea = $('txtAddMlbs');
    const status = $('addMlbsStatus');

    if (!panel) return;
    panel.hidden = false;

    if (textarea) {
      textarea.value = '';
      textarea.focus();
    }
    if (status) {
      status.textContent = '';
    }
  }

  function closeAddMlbsPanel() {
    const panel = $('addMlbsPanel');
    const textarea = $('txtAddMlbs');
    const status = $('addMlbsStatus');

    if (panel) panel.hidden = true;
    if (textarea) textarea.value = '';
    if (status) status.textContent = '';
  }

  async function handleAddMlbsConfirm() {
    const textarea = $('txtAddMlbs');
    const status = $('addMlbsStatus');

    if (!textarea) return;

    const raw = textarea.value || '';
    const mlbs = raw
      .split(/[\s,;]+/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (!mlbs.length) {
      toast('Informe ao menos um MLB.');
      return;
    }

    const progressWrap  = $('bulkAddProgress');
    const progressFill  = $('bulkAddProgressFill');
    const progressLabel = $('bulkAddProgressLabel');

    const total = mlbs.length;
    let processed  = 0;
    let okCount    = 0;
    let errorCount = 0;

    if (status) {
      status.textContent = `Enviando ${total} MLB(s)...`;
    }

    if (progressWrap && progressFill && progressLabel) {
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      progressLabel.textContent = `0 / ${total}`;
    }

    try {
      for (const mlb of mlbs) {
        try {
          const exists = rows.some((r) => String(r.mlb) === mlb);
          if (!exists) {
            rows.push({
              mlb,
              name: '',
              percent_default: null,
              percent_applied: null,
              status: 'novo',
            });
          }

          await fetchJSON('/api/estrategicos', {
            method: 'POST',
            body: JSON.stringify({ mlb }),
          });

          okCount += 1;
        } catch (err) {
          errorCount += 1;
          console.error('Erro ao adicionar MLB', mlb, err);
        } finally {
          processed += 1;
          if (progressFill && progressLabel) {
            const pct = (processed / total) * 100;
            progressFill.style.width = `${pct}%`;
            progressLabel.textContent = `${processed} / ${total}`;
          }
        }
      }

      let msg = `✅ ${okCount} MLB(s) adicionados/atualizados.`;
      if (errorCount > 0) {
        msg += ` ❗ ${errorCount} falharam (veja o console).`;
      }
      toast(msg);

      if (status) {
        status.textContent = 'Itens adicionados com sucesso.';
      }

      closeAddMlbsPanel();
      await loadRows();
    } catch (err) {
      console.error('handleAddMlbsConfirm:', err);
      toast(`❌ Erro ao adicionar itens: ${err.message}`);
      if (status) {
        status.textContent = `Erro: ${err.message}`;
      }
    } finally {
      if (progressWrap) {
        setTimeout(() => {
          progressWrap.hidden = true;
        }, 800);
      }
    }
  }

  // =========================
  // Upload CSV
  // =========================
  function parseCsvToItems(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    let startIndex = 0;
    const header = lines[0].toLowerCase();

    if (header.includes('mlb') && (header.includes('percent') || header.includes('desconto'))) {
      startIndex = 1; // pula cabeçalho
    }

    const items = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const parts = line.split(/[,;]+/g).map((p) => p.trim());
      if (!parts[0]) continue;

      const mlb = parts[0].toUpperCase();
      const percent = parts[1] != null && parts[1] !== ''
        ? Number(String(parts[1]).replace('%', '').replace(',', '.'))
        : null;

      items.push({
        mlb,
        percent_default: Number.isNaN(percent) ? null : percent,
      });
    }

    return items;
  }

  async function handleUploadProcess() {
    const fileInput = $('fileStrategicos');
    const chkRemove = $('chkRemoveMissing');
    const uploadStatus = $('uploadStatus');

    if (!fileInput || !fileInput.files || !fileInput.files.length) {
      toast('Selecione um arquivo primeiro.');
      return;
    }

    const file = fileInput.files[0];
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast('Por enquanto, só estou aceitando arquivos CSV.');
      return;
    }

    if (uploadStatus) {
      uploadStatus.textContent = 'Lendo arquivo...';
    }

    try {
      const text = await file.text();
      const items = parseCsvToItems(text);

      if (!items.length) {
        toast('Nenhuma linha válida encontrada no arquivo.');
        if (uploadStatus) uploadStatus.textContent = 'Nenhum dado válido encontrado.';
        return;
      }

      if (uploadStatus) {
        uploadStatus.textContent = `Enviando ${items.length} itens...`;
      }

      await fetchJSON('/api/estrategicos/replace', {
        method: 'POST',
        body: JSON.stringify({
          items,
          remove_missing: !!(chkRemove && chkRemove.checked),
        }),
      });

      toast(`✅ Lista atualizada com ${items.length} itens do arquivo.`);
      if (uploadStatus) uploadStatus.textContent = 'Lista atualizada com sucesso.';
      await loadRows();
    } catch (err) {
      console.error('handleUploadProcess:', err);
      toast(`❌ Erro ao processar arquivo: ${err.message}`);
      if (uploadStatus) uploadStatus.textContent = `Erro: ${err.message}`;
    }
  }

  // =========================
  // Preencher "% padrão (salvo)"
  // =========================
  function handleFillFromGlobal() {
    const inputGlobal = $('percentGlobal');
    if (!inputGlobal) return;

    const val = inputGlobal.value;
    if (val === '' || val == null) {
      toast('Informe um percentual padrão primeiro.');
      return;
    }

    const n = Number(val);
    if (Number.isNaN(n)) {
      toast('Percentual inválido.');
      return;
    }

    rows.forEach((r) => {
      r.percent_default = n;
    });

    const tbody = $('tbodyStrategicos');
    if (!tbody) return;

    tbody.querySelectorAll('tr').forEach((tr) => {
      const mlb = tr.getAttribute('data-mlb');
      const row = rows.find((r) => String(r.mlb) === String(mlb));
      if (!row) return;
      const input = tr.querySelector('input[data-field="percent_default"]');
      if (input) input.value = row.percent_default ?? '';
    });
  }

  // =========================
  // Aplicar promoções
  // =========================
  async function handleApplySelected() {
    const selected = getSelectedMlbs();
    if (!selected.length) {
      toast('Selecione ao menos um item na tabela.');
      return;
    }

    const promotionTypeSel = $('promotionType');
    const type = promotionTypeSel ? promotionTypeSel.value : 'DEAL';

    const items = [];
    for (const mlb of selected) {
      const row = rows.find((r) => String(r.mlb) === String(mlb));
      if (!row) continue;

      const pct = row.percent_default;
      if (pct == null || pct === '') continue;

      items.push({
        mlb,
        percent: Number(pct),
      });
    }

    if (!items.length) {
      toast('Nenhum dos itens selecionados possui % padrão preenchida.');
      return;
    }

    if (!confirm(
      `Confirmar aplicação de promoções para ${items.length} itens com tipo ${type}?`
    )) {
      return;
    }

    try {
      await fetchJSON('/api/estrategicos/apply', {
        method: 'POST',
        body: JSON.stringify({
          items,
          promotion_type: type,
        }),
      });

      toast('✅ Promoções enviadas para processamento.');
      await loadRows();
    } catch (err) {
      console.error('handleApplySelected:', err);
      toast(`❌ Erro ao aplicar promoções: ${err.message}`);
    }
  }

  // =========================
  // Bind de eventos estáticos
  // =========================
  function bindStaticEvents() {
    const groupSel = $('strategicGroup');
    if (groupSel) {
      groupSel.addEventListener('change', () => {
        currentGroup = groupSel.value;
        loadRows();
      });
      currentGroup = groupSel.value;
    }

    const btnAddRow = $('btnAddRow');
    if (btnAddRow) {
      btnAddRow.addEventListener('click', openAddMlbsPanel);
    }

    const btnAddMlbsConfirm = $('btnAddMlbsConfirm');
    const btnAddMlbsCancel  = $('btnAddMlbsCancel');

    if (btnAddMlbsConfirm) {
      btnAddMlbsConfirm.addEventListener('click', handleAddMlbsConfirm);
    }
    if (btnAddMlbsCancel) {
      btnAddMlbsCancel.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeAddMlbsPanel();
      });
    }

    const btnToggleUpload = $('btnToggleUpload');
    const uploadPanel = $('uploadPanel');
    const btnCloseUpload = $('btnCloseUpload');
    if (btnToggleUpload && uploadPanel) {
      btnToggleUpload.addEventListener('click', () => {
        uploadPanel.hidden = !uploadPanel.hidden;
      });
    }
    if (btnCloseUpload && uploadPanel) {
      btnCloseUpload.addEventListener('click', () => {
        uploadPanel.hidden = true;
      });
    }

    const btnProcessFile = $('btnProcessFile');
    if (btnProcessFile) {
      btnProcessFile.addEventListener('click', handleUploadProcess);
    }

    const btnFillFromGlobal = $('btnFillFromGlobal');
    if (btnFillFromGlobal) {
      btnFillFromGlobal.addEventListener('click', handleFillFromGlobal);
    }

    const btnApplySelected = $('btnApplySelected');
    if (btnApplySelected) {
      btnApplySelected.addEventListener('click', handleApplySelected);
    }

    const btnDeleteSelected = $('btnDeleteSelected');
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener('click', handleDeleteSelected);
    }

    const chkAll = $('chkSelectAllRows');
    if (chkAll) {
      chkAll.addEventListener('change', () => {
        const tbody = $('tbodyStrategicos');
        if (!tbody) return;
        const checks = tbody.querySelectorAll('.row-select');
        checks.forEach((c) => {
          c.checked = chkAll.checked;
        });
        updateSummarySelected();
      });
    }

    const tbody = $('tbodyStrategicos');
    if (tbody) {
      // Delegação de eventos na tabela
      tbody.addEventListener('change', (ev) => {
        const target = ev.target;
        if (!target) return;

        if (target.classList.contains('row-select')) {
          updateSummarySelected();
          return;
        }

        if (
          target.classList.contains('input-name') ||
          target.classList.contains('input-percent')
        ) {
          const tr = target.closest('tr[data-mlb]');
          if (!tr) return;
          const mlb = tr.getAttribute('data-mlb');
          const field = target.getAttribute('data-field');
          const row = rows.find((r) => String(r.mlb) === String(mlb));
          if (!row) return;

          if (field === 'name') {
            row.name = target.value;
          } else if (field === 'percent_default') {
            const n = target.value === '' ? null : Number(target.value);
            row.percent_default = Number.isNaN(n) ? null : n;
          }
        }
      });

      tbody.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;

        const tr = btn.closest('tr[data-mlb]');
        if (!tr) return;

        const mlb = tr.getAttribute('data-mlb');
        const action = btn.getAttribute('data-action');

        if (action === 'save-row') {
          saveRow(mlb);
        } else if (action === 'delete-row') {
          deleteRow(mlb);
        }
      });
    }

    // Eventos da paginação (delegação)
    const pagination = $('strategicPagination');
    if (pagination) {
      pagination.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-page]');
        if (!btn) return;

        const action = btn.getAttribute('data-page');
        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

        if (action === 'prev') {
          if (currentPage > 1) currentPage -= 1;
        } else if (action === 'next') {
          if (currentPage < totalPages) currentPage += 1;
        } else {
          const n = Number(action);
          if (!Number.isNaN(n)) {
            currentPage = Math.min(Math.max(1, n), totalPages);
          }
        }

        renderTable();
      });
    }
  }

  // =========================
  // Boot
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    try {
      bindStaticEvents();
      loadRows();
    } catch (err) {
      console.error('Erro na inicialização de estratégicos:', err);
    }
  });
})();
