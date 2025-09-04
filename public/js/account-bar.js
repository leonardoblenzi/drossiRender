// Pequeno helper para exibir/validar a conta no topo de QUALQUER página.
// Usa /api/account/current. Se não houver conta, manda para /select-conta.

window.AccountBar = (function () {
  let _loaded = false;

  async function load() {
    const lbl = document.querySelector('[data-account-label]');
    const btn = document.querySelector('[data-account-switch]');

    // timeout defensivo para a chamada de conta
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const r = await fetch('/api/account/current', {
        credentials: 'same-origin',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      let j = null;
      try { j = await r.json(); } catch { /* JSON inválido */ }

      if (j && j.accountKey) {
        const label = j.label ?? j.accountKey;
        if (lbl) lbl.textContent = label;
        window.__ACCOUNT__ = { key: j.accountKey, label };
      } else {
        if (lbl) lbl.textContent = 'nenhuma';
        // evita loop de redirecionamento se já estiver na tela de seleção
        if (location.pathname !== '/select-conta') location.replace('/select-conta');
        return;
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (lbl) lbl.textContent = 'erro';
      // em erro, não redireciona automaticamente para evitar loop em cenários off-line
    }

    if (btn) {
      // evita registrar múltiplos handlers se load() for chamado mais de uma vez
      btn.addEventListener('click', () => {
        if (location.pathname !== '/select-conta') window.location.href = '/select-conta';
      }, { once: true });
    }

    _loaded = true;
  }

  // expõe para quem quiser aguardar antes de inicializar a página
  async function ensure() {
    if (!window.__ACCOUNT__) {
      await load();
    }
    return window.__ACCOUNT__;
  }

  // auto-start quando o script for incluído (idempotente)
  document.addEventListener('DOMContentLoaded', () => {
    if (!_loaded) load();
  });

  return { load, ensure };
})();
