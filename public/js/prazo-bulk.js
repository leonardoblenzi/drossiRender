/* Fila para alteração de prazo (dias) utilizando APENAS fluxo legado:
   - POST /anuncios/prazo-dias-lote      -> { success, process_id }
   - GET  /anuncios/status-prazo/:id    -> { status, progresso, sucessos, erros, ... }

   Inclui "badge" (pill) com a conta ativa no JobsPanel.
*/
(function () {
  const QUEUE = [];
  let running = false;

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Mapeia conta -> classe CSS do badge
  function mapAccountBadge(key, label) {
    const k = String(key || "").toLowerCase();
    if (k === "drossi") return { text: label || "Drossi", cls: "badge-drossi" };
    if (k === "diplany")
      return { text: label || "Diplany", cls: "badge-diplany" };
    if (k === "rossidecor")
      return { text: label || "Rossi Decor", cls: "badge-rossidecor" };
    return { text: label || key || "Conta", cls: "badge-default" };
  }

  async function getAccountBadge() {
    try {
      if (window.__ACCOUNT__?.key) {
        return mapAccountBadge(
          window.__ACCOUNT__.key,
          window.__ACCOUNT__.label
        );
      }
      const r = await fetch("/api/account/current", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const key = j.accountKey || j.key || "default";
      const label = j.label || key;
      return mapAccountBadge(key, label);
    } catch {
      return { text: "Conta", cls: "badge-default" };
    }
  }

  async function startJob(entry) {
    const badge = await getAccountBadge();

    const tempId = JobsPanel.addLocalJob({
      title:
        entry.title ||
        `Prazo – ${entry.days} dia(s) • ${entry.items.length} itens`,
      badge,
    });

    let jobId = tempId;

    try {
      // dispara o processamento no backend LEGADO
      const resp = await fetch("/anuncios/prazo-dias-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mlb_ids: entry.items,
          days: entry.days,
          delay_ms: entry.delayMs ?? 250,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success || !data.process_id) {
        JobsPanel.updateLocalJob(jobId, {
          progress: 100,
          state: "erro ao iniciar",
          completed: true,
        });
        return;
      }

      // troca o id temporário pelo process_id
      jobId = JobsPanel.replaceId(tempId, String(data.process_id));

      // loop de status
      let done = false;
      while (!done) {
        await wait(2500);

        let st;
        try {
          const r = await fetch("/anuncios/status-prazo/" + jobId, {
            cache: "no-store",
          });
          st = await r.json();
        } catch {
          st = null;
        }

        if (!st) continue;

        const pct = Number(st.progresso ?? 0);
        const stateText =
          st.status === "concluido"
            ? `concluído: ${st.sucessos || 0} ok, ${st.erros || 0} erros`
            : `processando: ${st.processados || 0}/${
                st.total_anuncios || entry.items.length
              }`;

        JobsPanel.updateLocalJob(jobId, {
          progress: Number.isFinite(pct) ? pct : 0,
          state: stateText,
          completed: st.status === "concluido" || st.status === "erro",
        });

        done = st.status === "concluido" || st.status === "erro";
      }
    } catch (e) {
      JobsPanel.updateLocalJob(jobId, {
        progress: 100,
        state: "falha inesperada",
        completed: true,
      });
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    while (QUEUE.length) {
      const entry = QUEUE.shift();
      await startJob(entry);
    }
    running = false;
  }

  async function enqueue({ items, days, delayMs = 250, title }) {
    const list = (Array.isArray(items) ? items : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (!list.length) throw new Error("Nenhum MLB válido para enfileirar");

    const d = Number(days);
    if (!Number.isFinite(d) || d < 0 || Math.floor(d) !== d) {
      throw new Error("Dias inválidos. Use inteiro >= 0.");
    }

    QUEUE.push({ items: list, days: d, delayMs, title });
    pump(); // não aguarda
  }

  window.PrazoBulk = { enqueue };
})();
