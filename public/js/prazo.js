// public/js/prazo.js
(() => {
  console.log("⏱️ prazo.js carregado");

  // ===== Config (ajuste depois quando fecharmos as rotas reais)
  const API_SINGLE = "/api/prazo/update";
  const API_BULK_LEGACY = "/api/prazo/bulk"; // fallback sem painel
  const DEFAULT_DELAY_MS = 250;

  // ===== State
  let currentProcessId = null;
  let monitorInterval = null;

  // ===== Helpers DOM
  const $ = (s) => document.querySelector(s);

  const elMlbSingle = () => $("#prazoMlbId");
  const elDiasSingle = () => $("#prazoDiasSingle");
  const elDiasBulk = () => $("#prazoDiasBulk");
  const elMlbsBulk = () => $("#prazoMlbIds");
  const elRes = () => $("#resultado");

  // ===== Parse MLBs
  function parseFirstMlb(text) {
    const m = String(text || "")
      .toUpperCase()
      .match(/MLB\d{6,}/);
    return m ? m[0] : null;
  }

  function parseMlbs(text) {
    return Array.from(
      new Set(
        String(text || "")
          .split(/\r?\n+/)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^MLB\d{6,}$/.test(s))
      )
    );
  }

  function parseDays(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    if (n < 0) return null;
    return n;
  }

  // ===== UI result
  function box(type, msg) {
    elRes().innerHTML = `<div class="result ${type}">${msg}</div>`;
  }

  // ===== Notifications (simples)
  function notify(type, message) {
    // remove antigas
    document.querySelectorAll(".pz-notification").forEach((n) => n.remove());

    const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    const n = document.createElement("div");
    n.className = `pz-notification pz-notification--${type}`;
    n.style.cssText = `
      position: fixed;
      top: 18px;
      right: 18px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.18);
      border-left: 4px solid ${
        type === "success"
          ? "#16a34a"
          : type === "error"
          ? "#dc2626"
          : type === "warning"
          ? "#f59e0b"
          : "#6d28d9"
      };
      padding: 12px 14px;
      max-width: 360px;
      z-index: 2000;
      animation: pzSlideIn .25s ease-out;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    n.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start;">
        <div style="font-size:18px; line-height:1;">${
          icons[type] || icons.info
        }</div>
        <div style="flex:1; color:#111827; font-size:14px; line-height:1.35;">${message}</div>
        <button aria-label="Fechar" style="border:none;background:none;cursor:pointer;font-size:18px;line-height:1;color:#9ca3af;">×</button>
      </div>
    `;
    n.querySelector("button").addEventListener("click", () => n.remove());
    document.body.appendChild(n);

    setTimeout(() => {
      if (!n.parentElement) return;
      n.style.animation = "pzSlideOut .25s ease-out";
      setTimeout(() => n.remove(), 240);
    }, 4500);
  }

  function injectNotifKeyframes() {
    if (document.getElementById("pzNotifKeyframes")) return;
    const st = document.createElement("style");
    st.id = "pzNotifKeyframes";
    st.textContent = `
      @keyframes pzSlideIn { from{ transform: translateX(100%); opacity: 0 } to{ transform: translateX(0); opacity: 1 } }
      @keyframes pzSlideOut { from{ transform: translateX(0); opacity: 1 } to{ transform: translateX(100%); opacity: 0 } }
    `;
    document.head.appendChild(st);
  }

  // ===== API calls
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error || data?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // ===== Single
  async function prazoSingle() {
    injectNotifKeyframes();

    const rawMlb = elMlbSingle().value;
    const mlb = parseFirstMlb(rawMlb);
    const days = parseDays(elDiasSingle().value);

    if (!mlb) {
      notify("error", "Informe um MLB válido (ex: MLB1234567890).");
      return;
    }
    if (days === null) {
      notify("error", "Informe um prazo válido (dias inteiros, >= 0).");
      return;
    }

    const btn = $("#btnPrazoSingle");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.75";
    }

    box(
      "info",
      `🔄 Atualizando prazo...\n\nMLB: ${mlb}\nNovo prazo: ${days} dia(s)`
    );

    try {
      const data = await postJson(API_SINGLE, { mlb_id: mlb, days });

      // esperado: { ok:true, mlb_id, days, message, ... }
      const ok = data.ok ?? data.success ?? true;
      if (!ok)
        throw new Error(data.error || data.message || "Falha ao atualizar");

      box(
        "success",
        `✅ Prazo atualizado!\n\nMLB: ${data.mlb_id || mlb}\nPrazo: ${
          data.days ?? days
        } dia(s)\n${data.message ? `\n${data.message}` : ""}`
      );
      notify("success", `Prazo atualizado: ${mlb} → ${days} dia(s)`);
    } catch (e) {
      box("error", `❌ Erro ao atualizar prazo.\n\n${e.message}`);
      notify("error", `Erro: ${e.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "";
      }
    }
  }

  // ===== Bulk
  async function prazoBulk() {
    injectNotifKeyframes();

    const days = parseDays(elDiasBulk().value);
    if (days === null) {
      notify("error", "Informe um prazo válido (dias inteiros, >= 0).");
      return;
    }

    const mlbs = parseMlbs(elMlbsBulk().value);
    if (!mlbs.length) {
      notify("error", "Informe ao menos um MLB válido (um por linha).");
      return;
    }

    const btn = $("#btnPrazoBulk");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.75";
    }

    // Preferência: painel/fila (PrazoBulk + JobsPanel)
    if (window.PrazoBulk && typeof window.PrazoBulk.enqueue === "function") {
      try {
        await window.PrazoBulk.enqueue({
          items: mlbs,
          days,
          delayMs: DEFAULT_DELAY_MS,
          title: `Prazo – ${days} dia(s) • ${mlbs.length} itens`,
        });

        box(
          "info",
          `🚀 Processo enviado para o painel de processos.\n\nItens: ${mlbs.length}\nPrazo: ${days} dia(s)\n\nVocê pode continuar usando a página.`
        );
        notify(
          "info",
          "Processo enviado para o painel (canto inferior direito)."
        );
      } catch (e) {
        box("error", `❌ Falha ao enfileirar no painel.\n\n${e.message}`);
        notify("error", `Falha no painel: ${e.message}`);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = "";
        }
      }
      return;
    }

    // Fallback legado
    box(
      "info",
      `🚀 Iniciando atualização em lote (modo legado)...\n\nItens: ${mlbs.length}\nPrazo: ${days} dia(s)`
    );

    try {
      const data = await postJson(API_BULK_LEGACY, {
        mlb_ids: mlbs,
        days,
        delay_ms: 3000,
      });

      if (data.process_id) {
        currentProcessId = data.process_id;
        monitorarProgresso(currentProcessId);
      } else {
        // caso retorne algo direto
        box(
          "success",
          `✅ Lote enviado!\n\nItens: ${mlbs.length}\nPrazo: ${days} dia(s)\n${
            data.message ? `\n${data.message}` : ""
          }`
        );
      }

      notify("info", `Lote iniciado: ${mlbs.length} itens`);
    } catch (e) {
      box("error", `❌ Erro ao iniciar lote.\n\n${e.message}`);
      notify("error", `Erro: ${e.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "";
      }
    }
  }

  // ===== Status legado (se existir no backend)
  async function verificarStatus() {
    injectNotifKeyframes();

    if (!currentProcessId) {
      notify("warning", "Nenhum processamento ativo (modo legado).");
      return;
    }

    try {
      const r = await fetch(`/api/prazo/status/${currentProcessId}`, {
        cache: "no-store",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || data.message || `HTTP ${r.status}`);

      const concluido =
        data.status === "concluido"
          ? `\nConcluído: ${new Date(data.concluido_em).toLocaleString(
              "pt-BR"
            )}`
          : "";

      box(
        "info",
        `📊 STATUS (LEGADO)\n\nProcess ID: ${
          data.id || currentProcessId
        }\nStatus: ${data.status || "—"}\nProgresso: ${
          data.progresso ?? "—"
        }%\nProcessados: ${data.processados ?? "—"}/${
          data.total_anuncios ?? "—"
        }\nSucessos: ${data.sucessos ?? "—"}\nErros: ${
          data.erros ?? "—"
        }\nIniciado: ${
          data.iniciado_em
            ? new Date(data.iniciado_em).toLocaleString("pt-BR")
            : "—"
        }${concluido}`
      );

      notify("info", "Status atualizado.");
    } catch (e) {
      box("error", `❌ Erro ao buscar status.\n\n${e.message}`);
      notify("error", `Erro status: ${e.message}`);
    }
  }

  function monitorarProgresso(processId) {
    if (monitorInterval) clearInterval(monitorInterval);

    monitorInterval = setInterval(async () => {
      try {
        const r = await fetch(`/api/prazo/status/${processId}`, {
          cache: "no-store",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(data.error || data.message || `HTTP ${r.status}`);

        if (data.status === "concluido" || data.status === "erro") {
          clearInterval(monitorInterval);
          monitorInterval = null;
          verificarStatus();
        }
      } catch (_e) {
        clearInterval(monitorInterval);
        monitorInterval = null;
      }
    }, 3000);
  }

  // ===== Clear
  function limparSingle() {
    elMlbSingle().value = "";
    elDiasSingle().value = "";
    notify("info", "Campos unitários limpos.");
  }

  function limparBulk() {
    elDiasBulk().value = "";
    elMlbsBulk().value = "";
    notify("info", "Campos do lote limpos.");
  }

  function limparTudo() {
    elRes().innerHTML = "";
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    currentProcessId = null;
    notify("info", "Tudo limpo.");
  }

  // ===== Keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      prazoSingle();
    }
    if (event.ctrlKey && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      prazoBulk();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      limparTudo();
    }
  });

  // ===== Expose
  window.prazoSingle = prazoSingle;
  window.prazoBulk = prazoBulk;
  window.verificarStatus = verificarStatus;
  window.limparSingle = limparSingle;
  window.limparBulk = limparBulk;

  console.log("✅ prazo.js pronto");
})();
