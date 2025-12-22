// public/js/admin-usuarios.js
(() => {
  const $ = (id) => document.getElementById(id);

  const tbody = $('tbody');
  const search = $('search');
  const btnClear = $('btn-clear');
  const btnCreate = $('btn-create');
  const btnRefresh = $('btn-refresh');

  const btnPrev = $('btn-prev');
  const btnNext = $('btn-next');
  const pageInfo = $('page-info');
  const rangeInfo = $('range-info');
  const countPill = $('count-pill');

  const modal = $('modal-user');
  const modalTitle = $('modal-title');
  const modalClose = $('modal-close');
  const btnCancel = $('btn-cancel');
  const btnSave = $('btn-save');

  const fNome = $('f-nome');
  const fEmail = $('f-email');
  const fNivel = $('f-nivel');
  const fSenha = $('f-senha');
  const lblSenha = $('lbl-senha');
  const senhaHelp = $('senha-help');
  const formError = $('form-error');

  const toast = $('toast');

  let allUsers = [];
  let filtered = [];
  let page = 1;
  const perPage = 25;

  let mode = 'create'; // 'create' | 'edit'
  let editingId = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => (toast.style.display = 'none'), 2400);
  }

  function showModal() {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
  function hideModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  function setError(msg) {
    if (!msg) {
      formError.style.display = 'none';
      formError.textContent = '';
      return;
    }
    formError.style.display = 'block';
    formError.textContent = msg;
  }

  function formatDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function badgeNivel(nivel) {
    const n = String(nivel || 'usuario').toLowerCase();
    if (n === 'administrador') return `<span class="badge admin">ADMIN</span>`;
    return `<span class="badge user">USUÁRIO</span>`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function applyFilter() {
    const q = String(search.value || '').trim().toLowerCase();
    if (!q) {
      filtered = [...allUsers];
    } else {
      filtered = allUsers.filter(u => {
        const nome = String(u.nome || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        const nivel = String(u.nivel || '').toLowerCase();
        return nome.includes(q) || email.includes(q) || nivel.includes(q) || String(u.id).includes(q);
      });
    }
    page = 1;
    render();
  }

  function paginate(list) {
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    page = Math.min(Math.max(1, page), pages);

    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const slice = list.slice(start, end);

    return { total, pages, start, end, slice };
  }

  function render() {
    const { total, pages, start, end, slice } = paginate(filtered);

    countPill.textContent = `${total} usuário${total === 1 ? '' : 's'}`;
    pageInfo.textContent = `${page} / ${pages}`;
    rangeInfo.textContent = total
      ? `Mostrando ${start + 1}–${end} de ${total}`
      : 'Nenhum usuário encontrado';

    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= pages;

    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Nenhum usuário encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map(u => {
      const id = u.id;
      const nome = escapeHtml(u.nome || '—');
      const email = escapeHtml(u.email || '—');

      return `
        <tr>
          <td>${id}</td>
          <td>${nome}</td>
          <td>${email}</td>
          <td>${badgeNivel(u.nivel)}</td>
          <td>${formatDate(u.criado_em)}</td>
          <td>${formatDate(u.ultimo_login_em)}</td>
          <td>
            <div class="actions">
              <button class="icon-btn" data-action="edit" data-id="${id}" title="Editar">✏️</button>
              <button class="icon-btn danger" data-action="delete" data-id="${id}" title="Remover">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include', // pega cookie auth_token
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function loadUsers() {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Carregando…</td></tr>`;
    try {
      const data = await api('/api/admin/usuarios', { method: 'GET' });
      allUsers = Array.isArray(data.usuarios) ? data.usuarios : [];
      filtered = [...allUsers];
      applyFilter(); // já chama render
      showToast('Lista atualizada.');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Erro ao carregar usuários: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function openCreate() {
    mode = 'create';
    editingId = null;

    modalTitle.textContent = 'Cadastrar usuário';
    lblSenha.textContent = 'Senha *';
    senhaHelp.textContent = 'Obrigatória no cadastro.';
    fSenha.value = '';

    fNome.value = '';
    fEmail.value = '';
    fNivel.value = 'usuario';

    setError('');
    showModal();
    fEmail.focus();
  }

  function openEdit(user) {
    mode = 'edit';
    editingId = user.id;

    modalTitle.textContent = `Editar usuário #${user.id}`;
    lblSenha.textContent = 'Nova senha (opcional)';
    senhaHelp.textContent = 'Deixe vazio para manter a senha atual.';
    fSenha.value = '';

    fNome.value = user.nome || '';
    fEmail.value = user.email || '';
    fNivel.value = (user.nivel || 'usuario');

    setError('');
    showModal();
    fNome.focus();
  }

  async function saveUser() {
    setError('');

    const payload = {
      nome: String(fNome.value || '').trim() || null,
      email: String(fEmail.value || '').trim().toLowerCase(),
      nivel: String(fNivel.value || 'usuario').trim().toLowerCase()
    };
    const senha = String(fSenha.value || '');

    if (!payload.email) return setError('Informe o email.');
    if (mode === 'create' && !senha) return setError('Informe a senha para o cadastro.');

    if (senha) payload.senha = senha;

    btnSave.disabled = true;
    btnSave.textContent = 'Salvando…';

    try {
      if (mode === 'create') {
        await api('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Usuário criado.');
      } else {
        await api(`/api/admin/usuarios/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Usuário atualizado.');
      }

      hideModal();
      await loadUsers();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Erro ao salvar.');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Salvar';
    }
  }

  async function deleteUser(id) {
    const user = allUsers.find(u => Number(u.id) === Number(id));
    const label = user ? `${user.email} (#${user.id})` : `#${id}`;

    if (!confirm(`Remover o usuário ${label}?`)) return;

    try {
      await api(`/api/admin/usuarios/${id}`, { method: 'DELETE' });
      showToast('Usuário removido.');
      await loadUsers();
    } catch (e) {
      console.error(e);
      alert(`Erro ao remover: ${e.message}`);
    }
  }

  function bindEvents() {
    btnCreate.addEventListener('click', openCreate);
    btnRefresh.addEventListener('click', loadUsers);

    btnClear.addEventListener('click', () => {
      search.value = '';
      applyFilter();
      search.focus();
    });

    search.addEventListener('input', () => applyFilter());

    btnPrev.addEventListener('click', () => { page--; render(); });
    btnNext.addEventListener('click', () => { page++; render(); });

    modalClose.addEventListener('click', hideModal);
    btnCancel.addEventListener('click', hideModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideModal();
    });

    btnSave.addEventListener('click', saveUser);

    // ações da tabela
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.getAttribute('data-action');
      const id = Number(btn.getAttribute('data-id'));

      if (action === 'edit') {
        const user = allUsers.find(u => Number(u.id) === id);
        if (user) openEdit(user);
      }

      if (action === 'delete') {
        deleteUser(id);
      }
    });

    // ESC fecha modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') hideModal();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadUsers();
  });
})();
