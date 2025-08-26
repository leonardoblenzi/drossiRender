// Pequeno helper para exibir/validar a conta no topo de QUALQUER página.
// Usa /api/account/current. Se não houver conta, manda para /select-conta.

window.AccountBar = (function () {
  async function load() {
    const lbl = document.querySelector('[data-account-label]');
    const btn = document.querySelector('[data-account-switch]');
    try {
      const r = await fetch('/api/account/current', { credentials: 'same-origin' });
      const j = await r.json();
      if (j && j.accountKey) {
        if (lbl) lbl.textContent = j.label || j.accountKey;
        window.__ACCOUNT__ = { key: j.accountKey, label: j.label || j.accountKey };
      } else {
        // Sem conta -> força seleção
        if (lbl) lbl.textContent = 'nenhuma';
        window.location.href = '/select-conta';
        return;
      }
    } catch (e) {
      if (lbl) lbl.textContent = 'erro';
    }
    if (btn) btn.addEventListener('click', () => {
      window.location.href = '/select-conta';
    });
  }

  // expõe para quem quiser aguardar antes de inicializar a página
  async function ensure() {
    if (!window.__ACCOUNT__) {
      await load();
    }
    return window.__ACCOUNT__;
  }

  // auto-start quando o script for incluído
  document.addEventListener('DOMContentLoaded', load);

  return { load, ensure };
})();
