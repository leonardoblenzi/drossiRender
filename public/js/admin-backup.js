(() => {
  const $ = (id) => document.getElementById(id);

  const btnExport = $("btn-export");
  const btnImport = $("btn-import");
  const fileInp = $("file");
  const msg = $("msg");

  function show(text, type = "ok") {
    msg.style.display = "block";
    msg.textContent = text;

    msg.style.background =
      type === "err" ? "rgba(255,90,90,.12)" :
      type === "warn" ? "rgba(255,230,0,.12)" :
      "rgba(46,204,113,.12)";

    msg.style.color =
      type === "err" ? "#ff5a5a" :
      type === "warn" ? "#ffe600" :
      "#2ecc71";
  }

  function hide() {
    msg.style.display = "none";
    msg.textContent = "";
  }

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, { credentials: "include", ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
    return data;
  }

  btnExport?.addEventListener("click", () => {
    hide();
    // download direto
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

      await fetchJson("/api/admin/backup/import.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup }),
      });

      show("Backup restaurado com sucesso.", "ok");
    } catch (e) {
      console.error(e);
      show(`Falha ao restaurar: ${e.message}`, "err");
    } finally {
      btnImport.disabled = false;
      btnImport.textContent = "♻ Restaurar backup selecionado";
    }
  });
})();
