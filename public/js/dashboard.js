// public/js/dashboard.js
console.log("Dashboard script carregado");

// ===== Conta atual / Trocar conta (OAuth-only) =====
async function carregarContaAtual() {
  const currentEl = document.getElementById("account-current");
  const inlineEl = document.getElementById("account-name-inline");

  const setText = (txt) => {
    if (currentEl) currentEl.textContent = txt;
    if (inlineEl) inlineEl.textContent = txt;
  };

  try {
    const r = await fetch("/api/account/current", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    const ct = String(r.headers.get("content-type") || "");
    if (!ct.includes("application/json")) {
      setText("Indisponível");
      return;
    }

    const data = await r.json().catch(() => null);

    // esperado: { ok:true, accountType:'oauth', accountKey:'123', label:'...' }
    if ((data?.ok || data?.success) && data?.accountType === "oauth" && data?.accountKey) {
      const shown = String(data.label || "").trim() || "Conta selecionada";
      setText(shown);
      return;
    }

    setText("Não selecionada");
  } catch {
    setText("Indisponível");
  }
}

async function trocarConta() {
  try {
    await fetch("/api/meli/limpar-selecao", {
      method: "POST",
      credentials: "include",
    });
  } catch {}
  window.location.href = "/select-conta";
}

// ===== Notificações modernas =====
function showNotification(type, message) {
  const existing = document.querySelectorAll(".notification");
  existing.forEach((n) => n.remove());

  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;

  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };

  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-icon">${icons[type] || icons.info}</span>
      <span class="notification-message">${String(message || "").replace(/\n/g, "<br>")}</span>
      <button class="notification-close" type="button">×</button>
    </div>
  `;

  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    padding: 18px 16px;
    max-width: 420px;
    z-index: 1000;
    animation: slideInRight 0.3s ease-out;
    border-left: 4px solid ${
      type === "success"
        ? "#28a745"
        : type === "error"
        ? "#dc3545"
        : type === "warning"
        ? "#ffc107"
        : "#17a2b8"
    };
  `;

  notification.querySelector(".notification-close")?.addEventListener("click", () => {
    notification.remove();
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = "slideOutRight 0.3s ease-out";
      setTimeout(() => notification.remove(), 280);
    }
  }, 5000);
}

// CSS das notificações
(function injectNotificationStyles() {
  if (document.getElementById("notification-styles")) return;

  const st = document.createElement("style");
  st.id = "notification-styles";
  st.textContent = `
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    .notification-content { display:flex; align-items:flex-start; gap:10px; }
    .notification-icon { font-size: 20px; flex-shrink:0; }
    .notification-message { flex:1; line-height:1.4; color:#333; }
    .notification-close {
      background:none; border:none; font-size:20px; cursor:pointer;
      color:#999; padding:0; margin-left:10px; flex-shrink:0;
    }
    .notification-close:hover { color:#333; }
  `;
  document.head.appendChild(st);
})();

// ===== Token: verificar/renovar (1 única versão) =====
let isProcessing = false;

async function verificarToken(event) {
  if (isProcessing) return;

  const button = event?.target || null;
  const originalText = button ? button.textContent : null;

  try {
    isProcessing = true;
    if (button) {
      button.classList.add("btn-loading");
      button.textContent = "Verificando...";
    }

    const response = await fetch("/verificar-token", { credentials: "include" });
    const data = await response.json().catch(() => null);

    if (data?.success) {
      showNotification(
        "success",
        `✅ ${data.message}\nUser: ${data.nickname}\nToken: ${data.token_preview}`
      );
    } else {
      showNotification("error", `❌ ${data?.error || "Falha ao verificar token"}`);
    }
  } catch (error) {
    console.error("Erro ao verificar token:", error);
    showNotification("error", `❌ Erro: ${error.message}`);
  } finally {
    isProcessing = false;
    if (button) {
      button.classList.remove("btn-loading");
      button.textContent = originalText;
    }
  }
}

async function renovarToken(event) {
  if (isProcessing) return;

  const button = event?.target || null;
  const originalText = button ? button.textContent : null;

  try {
    isProcessing = true;
    if (button) {
      button.classList.add("btn-loading");
      button.textContent = "Renovando...";
    }

    const response = await fetch("/renovar-token-automatico", {
      method: "POST",
      credentials: "include",
    });

    const data = await response.json().catch(() => null);

    if (data?.success) {
      showNotification(
        "success",
        `✅ ${data.message}\nUser: ${data.nickname}\nNovo token: ${String(data.access_token || "").substring(0, 20)}...`
      );
    } else {
      showNotification("error", `❌ ${data?.error || "Falha ao renovar token"}`);
    }
  } catch (error) {
    console.error("Erro ao renovar token:", error);
    showNotification("error", `❌ Erro: ${error.message}`);
  } finally {
    isProcessing = false;
    if (button) {
      button.classList.remove("btn-loading");
      button.textContent = originalText;
    }
  }
}

// ===== Modal Processos =====
let intervalAtualizacao;

async function abrirModalProcessos() {
  document.getElementById("modal-processos").style.display = "block";
  await atualizarProcessos();
  intervalAtualizacao = setInterval(atualizarProcessos, 5000);
}

function fecharModalProcessos() {
  document.getElementById("modal-processos").style.display = "none";
  if (intervalAtualizacao) clearInterval(intervalAtualizacao);
}

async function atualizarProcessos() {
  try {
    const response = await fetch("/api/pesquisa-descricao/jobs?limite=20", { credentials: "include" });
    const data = await response.json().catch(() => null);
    if (data?.success) {
      atualizarEstatisticas(data.estatisticas_gerais);
      exibirProcessos(data.jobs);
      atualizarContadorDashboard(data.jobs);
    }
  } catch (error) {
    console.error("Erro ao atualizar processos:", error);
  }
}

function atualizarEstatisticas(stats) {
  document.getElementById("total-processando").textContent = stats?.processando_agora || 0;
  document.getElementById("total-aguardando").textContent = stats?.fila_aguardando || 0;
  document.getElementById("total-concluidos").textContent = stats?.concluidos_recentes || 0;
  document.getElementById("total-erros").textContent = stats?.falharam_recentes || 0;
}

function exibirProcessos(jobs) {
  const container = document.getElementById("lista-processos");
  if (!jobs || jobs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px;">
        <p>📭 Nenhum processo encontrado</p>
        <button class="btn-small btn-primary" onclick="iniciarNovoProcesso()">➕ Iniciar Primeiro Processo</button>
      </div>`;
    return;
  }

  container.innerHTML = jobs
    .map(
      (job) => `
    <div class="process-item ${job.status}">
      <div class="process-header">
        <div class="process-title">📋 ${job.job_id}</div>
        <div class="process-status ${job.status}">${job.status}</div>
      </div>
      <div style="font-size:14px; color:#666; margin:5px 0;">
        📊 ${job.concluidos + job.falharam}/${job.total_mlbs} MLBs processados
        ${job.tempo_decorrido ? `• ⏱️ ${job.tempo_decorrido}` : ""}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${job.progresso_percentual}%"></div>
      </div>
      <div class="process-actions">
        <button class="btn-small btn-primary" onclick="verDetalhesProcesso('${job.job_id}')">📊 Detalhes</button>
        ${
          job.status === "concluido"
            ? `<a href="/api/pesquisa-descricao/download/${job.job_id}" class="btn-small btn-success">📥 Download</a>`
            : ""
        }
        ${
          job.status === "processando" || job.status === "aguardando"
            ? `<button class="btn-small btn-danger" onclick="cancelarProcesso('${job.job_id}')">🚫 Cancelar</button>`
            : ""
        }
      </div>
    </div>
  `
    )
    .join("");
}

function atualizarContadorDashboard(jobs) {
  const ativos = (jobs || []).filter((j) => j.status === "processando" || j.status === "aguardando").length;
  const counter = document.getElementById("process-counter");
  const counterNumber = document.getElementById("counter-number");
  if (!counter || !counterNumber) return;

  if (ativos > 0) {
    counter.style.display = "inline-flex";
    counter.classList.add("pulsing");
    counterNumber.textContent = ativos;
  } else {
    counter.style.display = "none";
    counter.classList.remove("pulsing");
  }
}

async function verDetalhesProcesso(jobId) {
  try {
    const response = await fetch(`/api/pesquisa-descricao/status/${jobId}`, { credentials: "include" });
    const data = await response.json().catch(() => null);
    if (data?.success) {
      const job = data.status;
      alert(`📊 Detalhes do Processo: ${jobId}

Status: ${job.status}
Progresso: ${job.progresso_percentual}%
Total MLBs: ${job.total_mlbs}
Processados: ${job.concluidos + job.falharam}
Sucessos: ${job.concluidos}
Erros: ${job.falharam}
Tempo decorrido: ${job.tempo_decorrido}
${job.tempo_estimado_restante ? `Tempo restante: ${job.tempo_estimado_restante}` : ""}`);
    }
  } catch (error) {
    alert("❌ Erro ao obter detalhes: " + error.message);
  }
}

async function cancelarProcesso(jobId) {
  if (!confirm(`Tem certeza que deseja cancelar o processo ${jobId}?`)) return;
  try {
    const response = await fetch(`/api/pesquisa-descricao/cancelar/${jobId}`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json().catch(() => null);
    if (data?.success) {
      alert("✅ Processo cancelado com sucesso!");
      atualizarProcessos();
    } else {
      alert("❌ Erro ao cancelar: " + (data?.message || "falha"));
    }
  } catch (error) {
    alert("❌ Erro: " + error.message);
  }
}

function iniciarNovoProcesso() {
  window.location.href = "/pesquisa-descricao?novo_processo=true";
}

// ===== Utilitários opcionais =====
async function verificarStatusServidor() {
  try {
    const response = await fetch("/test", { credentials: "include" });
    if (response.ok) {
      console.log("✅ Servidor funcionando");
      return true;
    }
  } catch (error) {
    console.error("❌ Servidor não está respondendo:", error);
  }
  return false;
}

async function obterEstatisticas() {
  try {
    const response = await fetch("/debug/routes", { credentials: "include" });
    if (response.ok) {
      const data = await response.json().catch(() => null);
      if (data?.total_routes != null) console.log(`📊 Total de rotas disponíveis: ${data.total_routes}`);
      return data;
    }
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
  }
  return null;
}

function atualizarIndicadoresStatus() {
  const statusElements = document.querySelectorAll(".status");
  statusElements.forEach((element) => {
    if (element.classList.contains("warning")) {
      element.style.animation = "pulse 2s ease-in-out infinite";
    }
  });
}

function verificarAtualizacoes() {
  console.log("🔍 Verificando atualizações...");
}

// ===== Boot único (sem duplicar DOMContentLoaded) =====
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Dashboard inicializado");

  // conta
  carregarContaAtual();
  const switchBtn = document.getElementById("account-switch");
  if (switchBtn) switchBtn.addEventListener("click", trocarConta);

  // animação dos cards "new"
  const newFeatures = document.querySelectorAll(".endpoint.new");
  newFeatures.forEach((feature, index) => {
    setTimeout(() => {
      feature.style.animation = "pulse 2s ease-in-out 2";
    }, 1000 + index * 500);
  });

  // processos
  atualizarProcessos();

  // opcionais
  verificarStatusServidor();
  obterEstatisticas();
  atualizarIndicadoresStatus();
  verificarAtualizacoes();

  // atalhos
  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "r") {
      event.preventDefault();
      renovarToken();
    }
    if (event.ctrlKey && event.key === "t") {
      event.preventDefault();
      verificarToken();
    }
  });

  console.log("💡 Atalhos disponíveis:");
  console.log("   Ctrl + R: Renovar token");
  console.log("   Ctrl + T: Verificar token");
});

// fechar modal ao clicar fora
window.addEventListener("click", (event) => {
  const modal = document.getElementById("modal-processos");
  if (event.target === modal) fecharModalProcessos();
});

// Expor funções globalmente (botões HTML)
window.verificarToken = verificarToken;
window.renovarToken = renovarToken;
window.abrirModalProcessos = abrirModalProcessos;
window.fecharModalProcessos = fecharModalProcessos;
window.iniciarNovoProcesso = iniciarNovoProcesso;

console.log("✅ Dashboard pronto (OAuth-only)");
