/* public/js/select-conta.js
 * Novo padrão (OAuth + Banco):
 * - Lista contas vinculadas via GET /api/meli/contas
 * - Seleciona conta via POST /api/meli/selecionar -> seta cookie httpOnly meli_conta_id
 * - Limpa seleção via POST /api/meli/limpar-selecao (se você criar)
 *
 * Modo legado (ENV + /api/account/*) mantido comentado abaixo.
 */

(() => {
  const $ = (sel) => document.querySelector(sel);

  const elList = $("#list");
  const elAlert = $("#alert");
  const elCurrent = $("#account-current");

  const btnVincular = $("#btn-vincular");
  const btnSair = $("#btn-sair");
  const btnDashboard = $("#btn-dashboard");
  const btnLimpar = $("#btn-limpar");

  function showAlert(text, type = "warn") {
    elAlert.style.display = "block";
    elAlert.textContent = text;

    // leve styling sem depender de CSS novo
    elAlert.style.marginTop = "12px";
    elAlert.style.padding = "10px 12px";
    elAlert.style.borderRadius = "10px";
    elAlert.style.border = "1px solid rgba(255,255,255,.15)";
    elAlert.style.background =
      type === "err"
        ? "rgba(255,90,90,.12)"
        : type === "ok"
        ? "rgba(46,204,113,.12)"
        : "rgba(255,230,0,.12)";
    elAlert.style.color =
      type === "err" ? "#ff5a5a" : type === "ok" ? "#2ecc71" : "#ffe600";
  }

  function clearAlert() {
    elAlert.style.display = "none";
    elAlert.textContent = "";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR");
    } catch {
      return "—";
    }
  }

  function statusBadge(status) {
    const s = String(status || "").toLowerCase();
    if (s === "ativa") return "🟢 ativa";
    if (s === "revogada") return "🟠 revogada";
    if (s === "erro") return "🔴 erro";
    return status || "—";
  }

  function sanitize(str) {
    return String(str ?? "").replace(
      /[<>&'"]/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  function renderEmpty() {
    elList.innerHTML = `
      <div class="hint" style="opacity:.9; padding:14px;">
        Nenhuma conta do Mercado Livre vinculada ainda.<br/>
        Clique em <b>Vincular Conta</b> para conectar a primeira.
      </div>
    `;
  }

  function renderCards(contas, currentId = null) {
    if (!Array.isArray(contas) || contas.length === 0) {
      renderEmpty();
      elCurrent.textContent = "Não selecionada";
      return;
    }

    // Tenta mostrar a atual, se vier do backend (recomendado)
    if (currentId) {
      const cur = contas.find((c) => Number(c.id) === Number(currentId));
      if (cur)
        elCurrent.textContent = cur.apelido || `Conta ${cur.meli_user_id}`;
      else elCurrent.textContent = "Não selecionada";
    } else {
      // sem currentId vindo do backend -> não dá pra ler cookie httpOnly pelo JS
      elCurrent.textContent = "Selecione uma conta";
    }

    elList.innerHTML = contas
      .map((c) => {
        const isCurrent = currentId && Number(c.id) === Number(currentId);
        const title = sanitize(c.apelido || `Conta ${c.meli_user_id}`);
        const sub = [
          `ML User ID: ${sanitize(c.meli_user_id)}`,
          `Site: ${sanitize(c.site_id || "MLB")}`,
          `Status: ${sanitize(statusBadge(c.status))}`,
          `Criado: ${sanitize(fmtDate(c.criado_em))}`,
        ].join("<br>");

        return `
        <button
          class="acc-btn"
          data-id="${sanitize(c.id)}"
          style="${isCurrent ? "outline:2px solid rgba(255,230,0,.7);" : ""}"
        >
          ${title}
          <span class="sub">${sub}</span>
          <span style="display:block; margin-top:10px; font-size:.9rem; opacity:.9;">
            ${
              isCurrent
                ? "✅ Selecionada nesta sessão"
                : "👉 Clique para usar esta conta"
            }
          </span>
        </button>
      `;
      })
      .join("");

    // bind click nos cards
    [...elList.querySelectorAll(".acc-btn")].forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.getAttribute("data-id"));
        if (!Number.isFinite(id)) return;

        clearAlert();
        await selecionarContaOAuth(id);
      });
    });
  }

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...opts,
    });

    // se caiu no /login por redirect HTML, isso geralmente vira 200 com HTML
    const ct = String(r.headers.get("content-type") || "");
    if (!ct.includes("application/json")) {
      // se não é json, melhor mandar para login
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      throw new Error("Resposta inesperada (não JSON). Você está logado?");
    }

    const data = await r.json().catch(() => null);
    return { r, data };
  }

  // ===========================
  // NOVO PADRÃO (OAuth + Banco)
  // ===========================

  async function loadContasOAuth() {
    try {
      clearAlert();
      elList.innerHTML = `<div class="hint" style="padding:14px;">Carregando contas...</div>`;

      const { r, data } = await fetchJson("/api/meli/contas");

      if (!r.ok || !data || data.ok !== true) {
        const msg =
          data?.error || `Falha ao carregar contas (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      // ✅ Recomendação: faça o backend devolver `current_meli_conta_id` (lendo do cookie)
      // Exemplo de retorno:
      // { ok:true, contas:[...], current_meli_conta_id: 123 }
      const contas = data.contas || [];
      const currentId = data.current_meli_conta_id || null;

      renderCards(contas, currentId);
    } catch (e) {
      console.error(e);
      showAlert(`Erro ao carregar contas: ${e.message}`, "err");
      elList.innerHTML = `<div class="hint" style="padding:14px;">Falha ao carregar contas.</div>`;
    }
  }

  async function selecionarContaOAuth(meli_conta_id) {
    try {
      // ✅ precisa existir no backend:
      // POST /api/meli/selecionar { meli_conta_id }
      const { r, data } = await fetchJson("/api/meli/selecionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meli_conta_id }),
      });

      if (!r.ok || !data || data.ok !== true) {
        const msg = data?.error || `Falha ao selecionar (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      // depois de selecionar -> dashboard (agora token + rotas ML conseguem usar a conta)
      window.location.href = "/dashboard";
    } catch (e) {
      console.error(e);
      showAlert(`Falha ao selecionar conta: ${e.message}`, "err");
    }
  }

  async function limparSelecaoOAuth() {
    try {
      // ✅ opcional, mas recomendado criar no backend:
      // POST /api/meli/limpar-selecao (clearCookie meli_conta_id)
      const { r, data } = await fetchJson("/api/meli/limpar-selecao", {
        method: "POST",
      });

      if (!r.ok || !data || data.ok !== true) {
        const msg = data?.error || `Falha ao limpar (HTTP ${r.status}).`;
        throw new Error(msg);
      }

      showAlert("Seleção limpa. Escolha outra conta.", "ok");
      await loadContasOAuth();
    } catch (e) {
      // Se você ainda não criou a rota, pelo menos recarrega e avisa.
      console.warn("limparSelecaoOAuth:", e.message);
      showAlert(
        "Não foi possível limpar automaticamente (rota ainda não existe).",
        "warn"
      );
    }
  }

  // ===========================
  // MODO LEGADO (ENV /api/account/*)
  // Mantido comentado como pedido
  // ===========================

  /*
  async function loadAccountsLegacy() {
    const { r, data } = await fetchJson('/api/account/list');
    if (!r.ok || !data?.ok) throw new Error(data?.error || 'Falha /api/account/list');
    // data.accounts -> [{key,label,configured}]
    // data.current -> key
  }

  async function selectAccountLegacy(key) {
    const { r, data } = await fetchJson('/api/account/select', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ accountKey:key })
    });
    if (!r.ok || !data?.ok) throw new Error(data?.error || 'Falha /api/account/select');
    window.location.href = '/dashboard';
  }

  async function clearAccountLegacy() {
    await fetchJson('/api/account/clear', { method:'POST' });
    location.reload();
  }
  */

  // ===========================
  // Binds
  // ===========================

  btnVincular?.addEventListener("click", () => {
    // tela que você já tem (com botão que chama /api/meli/oauth/start)
    window.location.href = "/vincular-conta";
  });

  btnSair?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    window.location.href = "/login";
  });

  btnDashboard?.addEventListener("click", () => {
    window.location.href = "/dashboard";
  });

  btnLimpar?.addEventListener("click", async () => {
    await limparSelecaoOAuth();
  });

  // Start
  document.addEventListener("DOMContentLoaded", () => {
    loadContasOAuth();
  });
})();
