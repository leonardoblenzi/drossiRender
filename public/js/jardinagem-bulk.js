// public/js/jardinagem-bulk.js
(() => {
  console.log("🪴 jardinagem-bulk.js carregado");

  // =========================
  // Config
  // =========================
  // ✅ Lote: NÃO permite CLONE_NEW_CLOSE_OLD
  // ✅ FIX: rota no backend é /api/jardinagem/bulk (não /lote)
  const API_BULK = "/api/jardinagem/bulk";

  // Status por process_id
  const API_STATUS = (id) => `/api/jardinagem/status/${encodeURIComponent(id)}`;

  const DEFAULT_DELAY_MS = 250;

  // =========================
  // State
  // =========================
  let currentProcessId = null;
  let monitorInterval = null;

  // manter último report do lote (para CSV)
  let lastBulkResults = null; // [{ mlb_old, mlb_new, status }]

  // =========================
  // Helpers DOM
  // =========================
  const $ = (s) => document.querySelector(s);

  const elModeBulk = () => $("#jardModeBulk");
  const elMlbsBulk = () => $("#jardMlbIds");
  const elRes = () => $("#resultado");

  // =========================
  // Parse MLBs
  // =========================
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

  // =========================
  // UI result
  // =========================
  function box(type, msg) {
    if (!elRes()) return;
    elRes().innerHTML = `<div class="result ${type}">${msg}</div>`;
  }

  // botão de baixar CSV (injeta abaixo do box)
  function renderDownloadButtonIfAny() {
    if (!elRes()) return;

    // remove botão anterior se existir
    const old = elRes().querySelector('[data-jg-download="1"]');
    if (old) old.remove();

    if (!Array.isArray(lastBulkResults) || lastBulkResults.length === 0) return;

    const wrap = document.createElement("div");
    wrap.setAttribute("data-jg-download", "1");
    wrap.style.marginTop = "12px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "⬇️ Baixar Resultado";
    btn.addEventListener("click", () => downloadCsv(lastBulkResults));

    wrap.appendChild(btn);
    elRes().appendChild(wrap);
  }

  // CSV download (client-side)
  function csvEscape(v) {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  function downloadCsv(rows) {
    const header = ["mlb_old", "mlb_new", "status"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push([r.mlb_old, r.mlb_new, r.status].map(csvEscape).join(","));
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `jardinagem_resultado_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ✅ normalizar resultados do lote (mlb_old, mlb_new, status)
  function normalizeBulkResults(results, fallbackMode) {
    if (!Array.isArray(results)) return [];

    return results
      .map((r) => {
        if (!r || typeof r !== "object") return null;

        const mlbOld =
          r.mlb_old ||
          r.mlb ||
          r.old_mlb ||
          r.mlbId ||
          r.item ||
          r.id ||
          r.original_mlb;

        const mlbNew =
          r.mlb_new ||
          r.new_mlb ||
          r.relisted_id ||
          r?.result?.relisted?.id ||
          r?.relisted?.id ||
          r?.detail?.new_id ||
          r?.detail?.newId;

        // ✅ FIX: se já vier "status" do backend (success|error), usa ele
        let status = "";
        if (typeof r.status === "string" && r.status.trim()) {
          status = String(r.status).trim().toLowerCase();
          if (status !== "success" && status !== "error") {
            // fallback se vier algo fora do esperado
            status = r.ok === true || r.success === true ? "success" : "error";
          }
        } else {
          status = r.ok === true || r.success === true ? "success" : "error";
        }

        const oldNorm = String(mlbOld || "")
          .trim()
          .toUpperCase();
        const newNorm = String(mlbNew || "")
          .trim()
          .toUpperCase();

        return {
          mlb_old: /^MLB\d{6,}$/.test(oldNorm) ? oldNorm : oldNorm || "",
          mlb_new: /^MLB\d{6,}$/.test(newNorm) ? newNorm : newNorm || "",
          status,
          _mode: fallbackMode || r.mode || r.modo || "",
        };
      })
      .filter(Boolean);
  }

  // =========================
  // Notifications
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
  // Guard: clone mode proibido no lote
  // =========================
  function validateBulkMode(mode) {
    const m = String(mode || "").toUpperCase();
    if (!m) return { ok: false, error: "Selecione um modo (lote)." };
    if (m === "CLONE_NEW_CLOSE_OLD") {
      return { ok: false, error: "CLONE_NEW_CLOSE_OLD é apenas unitário." };
    }
    const allowed = new Set([
      "CLOSE_RELIST",
      "PAUSE_RELIST",
      "ONLY_CLOSE",
      "ONLY_PAUSE",
    ]);
    if (!allowed.has(m))
      return { ok: false, error: "Modo inválido para lote." };
    return { ok: true, mode: m };
  }

  // =========================
  // Bulk action
  // =========================
  async function jardinagemBulk() {
    injectNotifKeyframes();

    const rawMode = elModeBulk()?.value;
    const v = validateBulkMode(rawMode);
    if (!v.ok) {
      notify("error", v.error);
      return;
    }
    const mode = v.mode;

    const mlbs = parseMlbs(elMlbsBulk()?.value);
    if (!mlbs.length) {
      notify("error", "Informe ao menos um MLB válido (um por linha).");
      return;
    }

    const btn = $("#btnJardBulk");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.75";
    }

    // reset report anterior
    lastBulkResults = null;

    // Preferência: Painel/fila (JobsPanel)
    if (
      window.JardinagemBulk &&
      typeof window.JardinagemBulk.enqueue === "function"
    ) {
      try {
        await window.JardinagemBulk.enqueue({
          mode,
          items: mlbs,
          delayMs: DEFAULT_DELAY_MS,
          title: `Jardinagem • ${mode} • ${mlbs.length} itens`,
        });

        box(
          "info",
          `🚀 Processo enviado para o painel de processos.\n\nItens: ${mlbs.length}\nModo: ${mode}\n\nVocê pode continuar usando a página.`
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

    // Fallback: chama API diretamente (sem painel)
    box(
      "info",
      `🚀 Iniciando Jardinagem em lote...\n\nItens: ${mlbs.length}\nModo: ${mode}`
    );

    try {
      const data = await postJson(API_BULK, {
        mlbs,
        mode,
        delay_ms: DEFAULT_DELAY_MS,
      });

      // Caso retorne process_id (assíncrono)
      if (data.process_id || data.job_id || data.id) {
        currentProcessId = data.process_id || data.job_id || data.id;
        monitorarProgresso(currentProcessId);
        notify("info", `Lote iniciado (processo: ${currentProcessId}).`);
        box(
          "info",
          `📦 Lote iniciado.\n\nProcesso: ${currentProcessId}\nItens: ${mlbs.length}\nModo: ${mode}\n\nAcompanhe em Status ou no painel.`
        );
        return;
      }

      // Caso responda direto um report/results/resultados
      const results =
        data.resultados || data.results || data.report || data.itens || null;

      if (Array.isArray(results)) {
        const okCount = results.filter((r) => {
          if (!r) return false;
          if (typeof r.status === "string")
            return String(r.status).toLowerCase() === "success";
          return r.ok === true || r.success === true;
        }).length;
        const errCount = results.length - okCount;

        // normaliza e guarda para CSV
        lastBulkResults = normalizeBulkResults(results, mode);

        box(
          errCount ? "warning" : "success",
          `✅ Lote finalizado!\n\nItens: ${mlbs.length}\nModo: ${mode}\nSucesso: ${okCount}\nErros: ${errCount}\n\n` +
            `Arquivo: você pode baixar o CSV do resultado abaixo.`
        );

        renderDownloadButtonIfAny();
      } else {
        box(
          "success",
          `✅ Lote enviado!\n\nItens: ${mlbs.length}\nModo: ${mode}\n${
            data.message ? `\n${data.message}` : ""
          }`
        );
      }

      notify("success", `Jardinagem em lote: ${mlbs.length} itens (${mode})`);
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

  // =========================
  // Status (fallback)
  // =========================
  async function verificarStatus() {
    injectNotifKeyframes();

    if (!currentProcessId) {
      notify("warning", "Nenhum processamento ativo.");
      return;
    }

    try {
      const r = await fetch(API_STATUS(currentProcessId), {
        cache: "no-store",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data.error || data.message || `HTTP ${r.status}`);

      // ✅ FIX: considerar erro também como "finalizado"
      const done =
        data.status === "concluido" ||
        data.status === "done" ||
        data.status === "completed" ||
        data.status === "erro" ||
        data.status === "error";

      const msg =
        `📊 STATUS\n\nProcesso: ${data.id || currentProcessId}\nStatus: ${
          data.status || "—"
        }\n` +
        `Progresso: ${data.progress ?? data.progresso ?? "—"}%\n` +
        `Processados: ${data.processados ?? data.processed ?? "—"}/${
          data.total ?? data.total_anuncios ?? "—"
        }\n` +
        `Sucessos: ${data.sucessos ?? data.success ?? "—"}\n` +
        `Erros: ${data.erros ?? data.errors ?? "—"}`;

      box(
        done
          ? data.status === "erro" || data.status === "error"
            ? "error"
            : "success"
          : "info",
        msg
      );

      // ✅ FIX: status endpoint do seu controller retorna "resultados"
      if (done) {
        const results =
          data.resultados || data.results || data.report || data.itens || null;

        if (Array.isArray(results)) {
          const modeGuess =
            data.mode ||
            data.modo ||
            data?.meta?.mode ||
            data?.meta?.modo ||
            "";
          lastBulkResults = normalizeBulkResults(results, modeGuess);
          renderDownloadButtonIfAny();
        }
      }

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
        const r = await fetch(API_STATUS(processId), { cache: "no-store" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(data.error || data.message || `HTTP ${r.status}`);

        const done =
          data.status === "concluido" ||
          data.status === "done" ||
          data.status === "completed" ||
          data.status === "erro" ||
          data.status === "error";

        if (done) {
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

  // =========================
  // Expose (HTML onclick)
  // =========================
  window.jardinagemBulk = jardinagemBulk;

  // Também reaproveita o botão Status do HTML
  if (typeof window.verificarStatus !== "function")
    window.verificarStatus = verificarStatus;

  console.log("✅ jardinagem-bulk.js pronto");
})();
