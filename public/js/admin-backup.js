(() => {
  const $ = (id) => document.getElementById(id);

  const btnExport = $("btn-export");
  const btnImport = $("btn-import");
  const fileInp = $("file");
  const msg = $("msg");

  function show(content, type = "ok", opts = {}) {
    const { allowHtml = false } = opts;

    msg.style.display = "block";

    // tema por tipo
    const theme = {
      ok: {
        bg: "rgba(46,204,113,.12)",
        fg: "#1f7a45",
        bd: "rgba(46,204,113,.25)",
      },
      warn: {
        bg: "rgba(255,230,0,.12)",
        fg: "#7a5a00",
        bd: "rgba(176,137,0,.25)",
      },
      err: {
        bg: "rgba(255,90,90,.12)",
        fg: "#b91c1c",
        bd: "rgba(255,90,90,.25)",
      },
    }[type] || {
      bg: "rgba(46,204,113,.12)",
      fg: "#1f7a45",
      bd: "rgba(46,204,113,.25)",
    };

    msg.style.background = theme.bg;
    msg.style.color = theme.fg;
    msg.style.border = `1px solid ${theme.bd}`;

    if (allowHtml) msg.innerHTML = content;
    else msg.textContent = String(content ?? "");
  }

  function hide() {
    msg.style.display = "none";
    msg.textContent = "";
    msg.innerHTML = "";
  }

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...opts,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
    return data;
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtNumber(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString("pt-BR");
  }

  function formatInsertedHtml(resp) {
    // Esperado do backend:
    // { ok:true, inserted:{ usuarios:X, ... }, total_inserted:N, truncated:[...]? }
    const inserted =
      resp?.inserted && typeof resp.inserted === "object" ? resp.inserted : {};
    const total = Number(resp?.total_inserted);
    const hasTotal = Number.isFinite(total);

    // entries ordenadas por quantidade desc
    const entries = Object.entries(inserted)
      .map(([k, v]) => [k, Number(v) || 0])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));

    const nonZero = entries.filter(([, v]) => v > 0);
    const top = nonZero.slice(0, 20); // limite visual
    const rest = nonZero.length - top.length;

    const createdAt = resp?.restored_at || resp?.created_at || null;

    const pillStyle = `
      display:inline-flex; align-items:center; gap:8px;
      padding:6px 10px; border-radius:999px;
      background: rgba(109,40,217,.10);
      border:1px solid rgba(109,40,217,.18);
      color:#4c1d95; font-weight:900; font-size:12px;
    `;

    const badgeStyle = `
      display:inline-flex; align-items:center; justify-content:center;
      min-width: 42px;
      padding:4px 8px; border-radius:999px;
      background: rgba(0,0,0,.06);
      border:1px solid rgba(0,0,0,.08);
      font-weight:900; font-size:12px; color:#374151;
    `;

    const title = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-weight:1000; font-size:14px;">✅ Backup restaurado com sucesso</div>
          <div style="opacity:.85; font-size:12px;">
            ${
              createdAt
                ? `Processado em: <strong>${esc(createdAt)}</strong>`
                : "Import finalizado."
            }
          </div>
        </div>
        ${
          hasTotal
            ? `<div style="${pillStyle}">Total inserido: ${fmtNumber(
                total
              )}</div>`
            : ""
        }
      </div>
    `;

    const list = top.length
      ? `
        <div style="margin-top:12px;">
          <div style="font-weight:900; font-size:12px; opacity:.9; margin-bottom:8px;">
            Inseridos por tabela
          </div>
          <div style="
            display:grid;
            grid-template-columns: 1fr;
            gap:8px;
          ">
            ${top
              .map(
                ([t, n]) => `
                <div style="
                  display:flex; align-items:center; justify-content:space-between; gap:10px;
                  padding:10px 12px;
                  border-radius:12px;
                  background:#fff;
                  border:1px solid rgba(0,0,0,.08);
                ">
                  <div style="font-weight:900; color:#111827;">${esc(t)}</div>
                  <div style="${badgeStyle}">${fmtNumber(n)}</div>
                </div>
              `
              )
              .join("")}
          </div>
          ${
            rest > 0
              ? `<div style="margin-top:8px; font-size:12px; opacity:.85;">+${rest} tabelas com inserções (não exibidas)</div>`
              : ""
          }
        </div>
      `
      : `
        <div style="margin-top:10px; font-size:12px; opacity:.9;">
          Nenhum registro foi inserido (backup vazio ou sem dados).
        </div>
      `;

    const truncated =
      Array.isArray(resp?.truncated) && resp.truncated.length
        ? `
        <div style="
          margin-top:12px;
          padding:10px 12px;
          border-radius:12px;
          background: rgba(255,230,0,.10);
          border:1px solid rgba(176,137,0,.18);
          color:#7a5a00;
          font-size:12px;
        ">
          ⚠️ Atenção: algumas tabelas foram ignoradas/truncadas no restore:
          <div style="margin-top:6px; font-weight:900;">${esc(
            resp.truncated.join(", ")
          )}</div>
        </div>
      `
        : "";

    return `
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${title}
        ${list}
        ${truncated}
      </div>
    `;
  }

  btnExport?.addEventListener("click", () => {
    hide();
    window.location.href = "/api/admin/backup/export.json";
  });

  btnImport?.addEventListener("click", async () => {
    hide();

    const f = fileInp?.files?.[0];
    if (!f) return show("Selecione um arquivo .json primeiro.", "warn");

    const sure = confirm(
      "ATENÇÃO: Isso vai apagar os dados atuais e restaurar o backup.\n\nDeseja continuar?"
    );
    if (!sure) return;

    try {
      btnImport.disabled = true;
      btnImport.textContent = "Restaurando…";

      const text = await f.text();
      const backup = JSON.parse(text);

      const resp = await fetchJson("/api/admin/backup/import.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup }),
      });

      // ✅ mensagem bonita
      show(formatInsertedHtml(resp), "ok", { allowHtml: true });
    } catch (e) {
      console.error(e);
      show(
        `<div style="display:flex; flex-direction:column; gap:6px;">
          <div style="font-weight:1000;">❌ Falha ao restaurar</div>
          <div style="font-size:12px; opacity:.95;">${esc(e.message)}</div>
        </div>`,
        "err",
        { allowHtml: true }
      );
    } finally {
      btnImport.disabled = false;
      btnImport.textContent = "♻ Restaurar backup selecionado";
    }
  });
})();
