// Dashboard JavaScript
console.log("Dashboard script carregado");

// ===== Labels das contas =====
const ACCOUNT_LABELS = {
  drossi: "DRossi Interiores",
  diplany: "Diplany",
  rossidecor: "Rossi Decor",
};

// ===== Conta atual / Trocar conta =====
// ✅ NOVO (OAuth): usa /api/meli/current (label vem do banco via meli_contas)
// 🧩 LEGADO (comentado): fallback opcional para /api/account/current
async function carregarContaAtual() {
  const currentEl = document.getElementById("account-current");
  const inlineEl = document.getElementById("account-name-inline");

  // helper seguro (evita erro se algum elemento não existir na página)
  const setText = (txt) => {
    if (currentEl) currentEl.textContent = txt;
    if (inlineEl) inlineEl.textContent = txt;
  };

  try {
    // ✅ OAuth (novo padrão)
    const r = await fetch("/api/meli/current", { cache: "no-store" });

    // se o backend devolver HTML (por redirect), isso aqui evita crash
    const ct = String(r.headers.get("content-type") || "");
    if (!ct.includes("application/json")) {
      // se caiu em página (login/nao-autorizado), deixa algo amigável
      setText("Indisponível");
      return;
    }

    const data = await r.json();

    // formato esperado:
    // { ok:true, selected:true, label:"Conta X", meli_conta_id, meli_user_id, ... }
    if (data?.ok && data?.selected) {
      const shown =
        String(data.label || "").trim() ||
        (data.meli_user_id
          ? `Conta ${data.meli_user_id}`
          : "Conta selecionada");
      setText(shown);
      return;
    }

    // sem conta selecionada
    setText("Não selecionada");
    return;

    /* ============================
     * LEGADO (mantido comentado)
     * ============================
     * Se você ainda tiver rotas antigas em produção e quiser fallback automático,
     * descomente este bloco e remova o "return" acima.
     *
     * const r2 = await fetch("/api/account/current", { cache: "no-store" });
     * const ct2 = String(r2.headers.get("content-type") || "");
     * if (!ct2.includes("application/json")) { setText("Indisponível"); return; }
     * const data2 = await r2.json();
     * let shown2 = "Não selecionada";
     * if (data2 && (data2.ok || data2.success)) {
     *   shown2 = data2.label || ACCOUNT_LABELS[data2.accountKey] || data2.accountKey || "Desconhecida";
     * }
     * setText(shown2);
     */
  } catch (e) {
    setText("Indisponível");
  }
}

async function trocarConta() {
  try {
    await fetch("/api/account/clear", { method: "POST" });
    window.location.href = "/select-conta";
  } catch (e) {
    window.location.href = "/select-conta";
  }
}

// ===== Token: verificar/renovar =====
async function verificarToken() {
  try {
    const response = await fetch("/verificar-token");
    const data = await response.json();
    if (data.success) {
      alert(
        "✅ " +
          data.message +
          "\nUser: " +
          data.nickname +
          "\nToken: " +
          data.token_preview
      );
    } else {
      alert("❌ " + data.error);
    }
  } catch (error) {
    alert("❌ Erro: " + error.message);
  }
}

async function renovarToken() {
  try {
    const response = await fetch("/renovar-token-automatico", {
      method: "POST",
    });
    const data = await response.json();
    if (data.success) {
      alert(
        "✅ " +
          data.message +
          "\nUser: " +
          data.nickname +
          "\nNovo token: " +
          data.access_token.substring(0, 20) +
          "..."
      );
    } else {
      alert("❌ " + data.error);
    }
  } catch (error) {
    alert("❌ Erro: " + error.message);
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
    const response = await fetch("/api/pesquisa-descricao/jobs?limite=20");
    const data = await response.json();
    if (data.success) {
      atualizarEstatisticas(data.estatisticas_gerais);
      exibirProcessos(data.jobs);
      atualizarContadorDashboard(data.jobs);
    }
  } catch (error) {
    console.error("Erro ao atualizar processos:", error);
  }
}
function atualizarEstatisticas(stats) {
  document.getElementById("total-processando").textContent =
    stats.processando_agora || 0;
  document.getElementById("total-aguardando").textContent =
    stats.fila_aguardando || 0;
  document.getElementById("total-concluidos").textContent =
    stats.concluidos_recentes || 0;
  document.getElementById("total-erros").textContent =
    stats.falharam_recentes || 0;
}
function exibirProcessos(jobs) {
  const container = document.getElementById("lista-processos");
  if (!jobs || jobs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px;">
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
      <div style="font-size: 14px; color: #666; margin: 5px 0;">
        📊 ${job.concluidos + job.falharam}/${job.total_mlbs} MLBs processados
        ${job.tempo_decorrido ? `• ⏱️ ${job.tempo_decorrido}` : ""}
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width: ${
        job.progresso_percentual
      }%"></div></div>
      <div class="process-actions">
        <button class="btn-small btn-primary" onclick="verDetalhesProcesso('${
          job.job_id
        }')">📊 Detalhes</button>
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
  const ativos = (jobs || []).filter(
    (j) => j.status === "processando" || j.status === "aguardando"
  ).length;
  const counter = document.getElementById("process-counter");
  const counterNumber = document.getElementById("counter-number");
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
    const response = await fetch(`/api/pesquisa-descricao/status/${jobId}`);
    const data = await response.json();
    if (data.success) {
      const job = data.status;
      alert(`📊 Detalhes do Processo: ${jobId}
      
Status: ${job.status}
Progresso: ${job.progresso_percentual}%
Total MLBs: ${job.total_mlbs}
Processados: ${job.concluidos + job.falharam}
Sucessos: ${job.concluidos}
Erros: ${job.falharam}
Tempo decorrido: ${job.tempo_decorrido}
${
  job.tempo_estimado_restante
    ? `Tempo restante: ${job.tempo_estimado_restante}`
    : ""
}`);
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
    });
    const data = await response.json();
    if (data.success) {
      alert("✅ Processo cancelado com sucesso!");
      atualizarProcessos();
    } else {
      alert("❌ Erro ao cancelar: " + data.message);
    }
  } catch (error) {
    alert("❌ Erro: " + error.message);
  }
}
function iniciarNovoProcesso() {
  window.location.href = "/pesquisa-descricao?novo_processo=true";
}

// ===== Boot =====
document.addEventListener("DOMContentLoaded", () => {
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

  atualizarProcessos();
});

// fechar modal ao clicar fora
window.addEventListener("click", (event) => {
  const modal = document.getElementById("modal-processos");
  if (event.target === modal) fecharModalProcessos();
});

// Variáveis globais
let isProcessing = false;

// Função para verificar token
async function verificarToken() {
  if (isProcessing) return;

  const button = event.target;
  const originalText = button.textContent;

  try {
    isProcessing = true;
    button.classList.add("btn-loading");
    button.textContent = "Verificando...";

    const response = await fetch("/verificar-token");
    const data = await response.json();

    if (data.success) {
      showNotification(
        "success",
        `✅ ${data.message}\nUser: ${data.nickname}\nToken: ${data.token_preview}`
      );
    } else {
      showNotification("error", `❌ ${data.error}`);
    }
  } catch (error) {
    console.error("Erro ao verificar token:", error);
    showNotification("error", `❌ Erro: ${error.message}`);
  } finally {
    isProcessing = false;
    button.classList.remove("btn-loading");
    button.textContent = originalText;
  }
}

// Função para renovar token
async function renovarToken() {
  if (isProcessing) return;

  const button = event.target;
  const originalText = button.textContent;

  try {
    isProcessing = true;
    button.classList.add("btn-loading");
    button.textContent = "Renovando...";

    const response = await fetch("/renovar-token-automatico", {
      method: "POST",
    });

    const data = await response.json();

    if (data.success) {
      showNotification(
        "success",
        `✅ ${data.message}\nUser: ${
          data.nickname
        }\nNovo token: ${data.access_token.substring(0, 20)}...`
      );
    } else {
      showNotification("error", `❌ ${data.error}`);
    }
  } catch (error) {
    console.error("Erro ao renovar token:", error);
    showNotification("error", `❌ Erro: ${error.message}`);
  } finally {
    isProcessing = false;
    button.classList.remove("btn-loading");
    button.textContent = originalText;
  }
}

// Função para mostrar notificações modernas
function showNotification(type, message) {
  // Remover notificações existentes
  const existingNotifications = document.querySelectorAll(".notification");
  existingNotifications.forEach((n) => n.remove());

  // Criar nova notificação
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;

  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icons[type] || icons.info}</span>
            <span class="notification-message">${message.replace(
              /\n/g,
              "<br>"
            )}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

  // Adicionar estilos
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        padding: 20px;
        max-width: 400px;
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

  // Adicionar ao DOM
  document.body.appendChild(notification);

  // Auto remover após 5 segundos
  setTimeout(() => {
    if (notification.parentElement) {
      notification.style.animation = "slideOutRight 0.3s ease-out";
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
}

// Adicionar estilos CSS para notificações
const notificationStyles = document.createElement("style");
notificationStyles.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }
    
    .notification-icon {
        font-size: 20px;
        flex-shrink: 0;
    }
    
    .notification-message {
        flex: 1;
        line-height: 1.4;
        color: #333;
    }
    
    .notification-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #999;
        padding: 0;
        margin-left: 10px;
        flex-shrink: 0;
    }
    
    .notification-close:hover {
        color: #333;
    }
`;

document.head.appendChild(notificationStyles);

// Função para verificar status do servidor
async function verificarStatusServidor() {
  try {
    const response = await fetch("/test");
    if (response.ok) {
      console.log("✅ Servidor funcionando");
      return true;
    }
  } catch (error) {
    console.error("❌ Servidor não está respondendo:", error);
    return false;
  }
}

// Função para obter estatísticas do dashboard
async function obterEstatisticas() {
  try {
    const response = await fetch("/debug/routes");
    if (response.ok) {
      const data = await response.json();
      console.log(`📊 Total de rotas disponíveis: ${data.total_routes}`);
      return data;
    }
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
  }
}

// Função para atualizar indicadores de status
function atualizarIndicadoresStatus() {
  const statusElements = document.querySelectorAll(".status");

  statusElements.forEach((element) => {
    if (element.classList.contains("warning")) {
      element.style.animation = "pulse 2s ease-in-out infinite";
    }
  });
}

// Função para verificar se há atualizações disponíveis
async function verificarAtualizacoes() {
  // Esta função pode ser expandida para verificar atualizações
  console.log("🔍 Verificando atualizações...");
}

// Inicialização quando a página carrega
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 Dashboard inicializado");

  // Verificar status do servidor
  verificarStatusServidor();

  // Obter estatísticas
  obterEstatisticas();

  // Atualizar indicadores
  atualizarIndicadoresStatus();

  // Verificar atualizações
  verificarAtualizacoes();

  // Adicionar listeners para teclas de atalho
  document.addEventListener("keydown", function (event) {
    // Ctrl + R para renovar token
    if (event.ctrlKey && event.key === "r") {
      event.preventDefault();
      renovarToken();
    }

    // Ctrl + T para verificar token
    if (event.ctrlKey && event.key === "t") {
      event.preventDefault();
      verificarToken();
    }
  });

  console.log("💡 Atalhos disponíveis:");
  console.log("   Ctrl + R: Renovar token");
  console.log("   Ctrl + T: Verificar token");
});

// Função para mostrar informações de ajuda
function mostrarAjuda() {
  const ajuda = `
🔧 AJUDA - Dashboard API Mercado Livre

📋 Funcionalidades:
• Verificar Token: Testa se o ACCESS_TOKEN está funcionando
• Renovar Token: Gera um novo ACCESS_TOKEN usando REFRESH_TOKEN
• Remover Promoções: Interface para remover promoções de anúncios

⌨️ Atalhos:
• Ctrl + R: Renovar token
• Ctrl + T: Verificar token

🔑 Configuração:
Certifique-se de que seu arquivo .env contém:
• ACCESS_TOKEN
• REFRESH_TOKEN
• APP_ID
• CLIENT_SECRET

❓ Problemas comuns:
• Token expirado: Use "Renovar Token"
• Erro 401: Verifique suas credenciais no .env
• Erro de conexão: Verifique sua internet

📞 Suporte:
Em caso de problemas, verifique os logs do console (F12)
    `;

  showNotification("info", ajuda);
}

// Expor funções globalmente para uso nos botões HTML
window.verificarToken = verificarToken;
window.renovarToken = renovarToken;
window.mostrarAjuda = mostrarAjuda;

console.log("✅ Todas as funções do dashboard carregadas");
