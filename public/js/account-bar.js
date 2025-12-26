// public/js/accountBar.js
// OAuth-only: mostra a conta atual na navbar usando /api/account/current.
// Se não houver conta e não estiver em /select-conta, redireciona pra seleção.

window.AccountBar = (function () {
  let _loaded = false;

  function pickAccountPayload(j = {}) {
    // esperado: { accountType:'oauth', accountKey:'123', label:'...' }
    const key = j.accountKey || (j.current && j.current.id) || null;
    const label = j.label || (j.current && j.current.label) || "";
    return { key, label };
  }

  async function load() {
    if (_loaded && window.__ACCOUNT__) return window.__ACCOUNT__;

    const lbl = document.querySelector("[data-account-label]");
    const btn = document.querySelector("[data-account-switch]");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const r = await fetch("/api/account/current", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const ct = String(r.headers.get("content-type") || "");
      if (!ct.includes("application/json")) {
        if (lbl) lbl.textContent = "indisponível";
        return null;
      }

      const j = await r.json().catch(() => ({}));
      const acc = pickAccountPayload(j);

      if (acc.key) {
        if (lbl) lbl.textContent = acc.label || "Conta selecionada";
        window.__ACCOUNT__ = {
          key: String(acc.key),
          label: String(acc.label || "").trim() || "Conta selecionada",
        };
      } else {
        if (lbl) lbl.textContent = "nenhuma";
        if (location.pathname !== "/select-conta") location.replace("/select-conta");
        return null;
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (lbl) lbl.textContent = e?.name === "AbortError" ? "tempo esgotado" : "erro";
      // em erro, não redireciona automaticamente pra evitar loop off-line
      return null;
    }

    if (btn) {
      btn.addEventListener(
        "click",
        () => {
          if (location.pathname !== "/select-conta") window.location.href = "/select-conta";
        },
        { once: true }
      );
    }

    _loaded = true;
    return window.__ACCOUNT__;
  }

  async function ensure() {
    if (!window.__ACCOUNT__) return await load();
    return window.__ACCOUNT__;
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!_loaded) load();
  });

  return { load, ensure };
})();
