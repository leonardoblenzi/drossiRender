// public/js/jardinagem.js
(() => {
  console.log("🪴 jardinagem.js carregado");

  // =========================
  // Config (ajuste depois pro seu backend real)
  // =========================
  // ✅ Unitário: permite CLONE_NEW_CLOSE_OLD
  const API_SINGLE = "/api/jardinagem/item";

  // ✅ Lote: NÃO permite clone (o bulk.js vai usar)
  const API_STATUS = (id) => `/api/jardinagem/status/${encodeURIComponent(id)}`;

  // =========================
  // Helpers DOM
  // =========================
  const $ = (s) => document.querySelector(s);

  const elMlbSingle = () => $("#jardMlbId");
  const elModeSingle = () => $("#jardModeSingle");
  const elCloneBox = () => $("#cloneOverrides");
  const elClonePrice = () => $("#clonePrice");
  const elCloneQty = () => $("#cloneQty");
  const elCloneTitle = () => $("#cloneTitle");

  const elMlbsBulk = () => $("#jardMlbIds");
  const elModeBulk = () => $("#jardModeBulk");

  const elRes = () => $("#resultado");

  // =========================
  // Parse MLBs
  // =========================
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

  function parseMoney(v) {
    // aceita "199,90" e "199.90"
    const s = String(v ?? "")
      .trim()
      .replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  function parseIntOrNull(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    return n;
  }

  // =========================
  // UI result
  // =========================
  function box(type, msg) {
    elRes().innerHTML = `<div class="result ${type}">${msg}</div>`;
  }

  // =========================
  // Notifications (mesmo estilo do prazo)
  // =========================
  function injectNotifKeyframes() {
    if (document.getElementById("jgNotifKeyframes")) return;
    const st = document.createElement("style");
    st.id = "jgNotifKeyframes";
    st.textContent = `
      @keyframes jgSlideIn { from{ transform: translateX(100%); opacity: 0 } to{ transform: translateX(0); opacity: 1 } }
      @keyframes jgSlideOut { from{ transform: translateX(0); opacity: 1 } to{ transform: translateX(100%); opacity: 0 } }
    `;
    document.head.appendChild(st);
  }

  function notify(type, message) {
    document.querySelectorAll(".jg-notification").forEach((n) => n.remove());

    const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    const n = document.createElement("div");
    n.className = `jg-notification jg-notification--${type}`;
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
          : "#0284c7"
      };
      padding: 12px 14px;
      max-width: 380px;
      z-index: 2000;
      animation: jgSlideIn .25s ease-out;
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
      n.style.animation = "jgSlideOut .25s ease-out";
      setTimeout(() => n.remove(), 240);
    }, 4500);
  }

  // =========================
  // API helper
  // =========================
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

  // =========================
  // UI: Toggle Clone Box
  // =========================
  function isCloneMode(mode) {
    return String(mode || "").toUpperCase() === "CLONE_NEW_CLOSE_OLD";
  }

  function setCloneBoxVisible(visible) {
    const boxEl = elCloneBox();
    if (!boxEl) return;
    boxEl.style.display = visible ? "block" : "none";
  }

  function clearCloneFields() {
    if (elClonePrice()) elClonePrice().value = "";
    if (elCloneQty()) elCloneQty().value = "";
    if (elCloneTitle()) elCloneTitle().value = "";
  }

  function refreshCloneUi() {
    const mode = elModeSingle()?.value;
    const show = isCloneMode(mode);
    setCloneBoxVisible(show);
    if (!show) clearCloneFields();
  }

  // =========================
  // Single action
  // =========================
  async function jardinagemSingle() {
    injectNotifKeyframes();

    const rawMlb = elMlbSingle().value;
    const mlb = parseFirstMlb(rawMlb);
    const mode = String(elModeSingle().value || "").toUpperCase();

    if (!mlb) {
      notify("error", "Informe um MLB válido (ex: MLB1234567890).");
      return;
    }
    if (!mode) {
      notify("error", "Selecione um modo (unitário).");
      return;
    }

    const btn = $("#btnJardSingle");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.75";
    }

    const isClone = isCloneMode(mode);

    const body = { mlb, mode };

    if (isClone) {
      const price = parseMoney(elClonePrice()?.value);
      const quantity = parseIntOrNull(elCloneQty()?.value);
      const title = String(elCloneTitle()?.value || "").trim();

      const clone_overrides = {};
      if (price !== null) clone_overrides.price = price;
      if (quantity !== null) clone_overrides.quantity = quantity;
      if (title) clone_overrides.title = title;

      // só envia se tiver alguma coisa
      if (Object.keys(clone_overrides).length)
        body.clone_overrides = clone_overrides;
    }

    box(
      "info",
      `🪴 Executando Jardinagem...\n\nMLB: ${mlb}\nModo: ${mode}${
        isClone ? "\n\n(Com ajustes de clone, se informados)" : ""
      }`
    );

    try {
      const data = await postJson(API_SINGLE, body);

      const ok = data.ok ?? data.success ?? true;
      if (!ok)
        throw new Error(data.error || data.message || "Falha ao executar");

      const oldId = data.old_mlb || data.old_id || data.mlb || mlb;
      const newId = data.new_mlb || data.new_id || data.created_mlb || "";

      const extra = newId ? `\nNovo MLB: ${newId}` : "";

      box(
        "success",
        `✅ Jardinagem concluída!\n\nMLB: ${oldId}\nModo: ${mode}${extra}\n${
          data.message ? `\n${data.message}` : ""
        }`
      );

      notify(
        "success",
        newId
          ? `Jardinagem ok: ${oldId} → ${newId} (${mode})`
          : `Jardinagem ok: ${oldId} (${mode})`
      );
    } catch (e) {
      box("error", `❌ Erro ao executar Jardinagem.\n\n${e.message}`);
      notify("error", `Erro: ${e.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "";
      }
    }
  }

  // =========================
  // Status (placeholder — se você usar modo legado/process_id)
  // =========================
  let currentProcessId = null;

  async function verificarStatus() {
    injectNotifKeyframes();

    if (!currentProcessId) {
      notify(
        "warning",
        "Nenhum processamento ativo (status legado não iniciado)."
      );
      return;
    }

    try {
      const r = await fetch(API_STATUS(currentProcessId), {
        cache: "no-store",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || data.message || `HTTP ${r.status}`);

      box(
        "info",
        `📊 STATUS\n\nProcess ID: ${data.id || currentProcessId}\nStatus: ${
          data.status || "—"
        }\nProgresso: ${data.progress ?? data.progresso ?? "—"}%`
      );
      notify("info", "Status atualizado.");
    } catch (e) {
      box("error", `❌ Erro ao buscar status.\n\n${e.message}`);
      notify("error", `Erro status: ${e.message}`);
    }
  }

  // =========================
  // Clear
  // =========================
  function limparSingle() {
    if (elMlbSingle()) elMlbSingle().value = "";
    if (elModeSingle()) elModeSingle().value = "CLOSE_RELIST";
    clearCloneFields();
    refreshCloneUi();
    notify("info", "Campos unitários limpos.");
  }

  function limparBulk() {
    if (elModeBulk()) elModeBulk().value = "CLOSE_RELIST";
    if (elMlbsBulk()) elMlbsBulk().value = "";
    notify("info", "Campos do lote limpos.");
  }

  function limparTudo() {
    if (elRes()) elRes().innerHTML = "";
    currentProcessId = null;
    notify("info", "Tudo limpo.");
  }

  // =========================
  // Keyboard shortcuts
  // =========================
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      jardinagemSingle();
    }
    if (event.ctrlKey && event.shiftKey && event.key === "Enter") {
      // lote é tratado no arquivo jardinagem-bulk.js
      // aqui só damos um aviso se o bulk ainda não estiver carregado
      event.preventDefault();
      if (typeof window.jardinagemBulk === "function") window.jardinagemBulk();
      else notify("info", "Bulk ainda não carregado. (jardinagem-bulk.js)");
    }
    if (event.key === "Escape") {
      event.preventDefault();
      limparTudo();
    }
  });

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // estado inicial
    refreshCloneUi();

    // toggle quando muda o modo
    const sel = elModeSingle();
    if (sel) sel.addEventListener("change", refreshCloneUi);
  });

  // =========================
  // Expose (HTML onclick usa isso)
  // =========================
  window.jardinagemSingle = jardinagemSingle;
  window.verificarStatus = verificarStatus;
  window.limparSingle = limparSingle;
  window.limparBulk = limparBulk;

  console.log("✅ jardinagem.js pronto");
})();
