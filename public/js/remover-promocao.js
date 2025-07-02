// Remover Promoção JavaScript
console.log('Script de remoção de promoções carregado');

// Variáveis globais
let currentProcessId = null;
let monitorInterval = null;
let isProcessing = false;

// Função para remover promoção única
async function removerUnico() {
    console.log('Função removerUnico chamada');
    
    if (isProcessing) {
        showNotification('warning', '⚠️ Já existe um processamento em andamento');
        return;
    }
    
    const mlbId = document.getElementById('mlbId').value.trim();
    console.log('MLB ID:', mlbId);
    
    if (!mlbId) {
        showNotification('error', '❌ Digite um MLB ID');
        return;
    }

    if (!validarMLBId(mlbId)) {
        showNotification('error', '❌ MLB ID inválido. Use o formato: MLB1234567890');
        return;
    }

    const resultado = document.getElementById('resultado');
    const button = event.target;
    const originalText = button.textContent;

    try {
        isProcessing = true;
        button.classList.add('btn-loading');
        button.textContent = 'Processando...';
        
        resultado.innerHTML = createResultBox('info', '🔄 Removendo promoção...', true);

        console.log('Enviando requisição para remover promoção...');
        
        const response = await fetch('/anuncio/remover-promocao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mlb_id: mlbId })
        });

        console.log('Resposta recebida:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Dados:', data);

        if (data.success) {
            const detalhes = formatarDetalhesResposta(data);
            resultado.innerHTML = createResultBox('success', `✅ SUCESSO!\n\n${detalhes}`);
            showNotification('success', `✅ Promoção removida com sucesso para ${data.mlb_id}`);
        } else {
            const erro = `❌ ERRO\n\n${data.message || data.error}\n${data.mlb_id ? 'MLB: ' + data.mlb_id : ''}`;
            resultado.innerHTML = createResultBox('error', erro);
            showNotification('error', `❌ Erro ao remover promoção: ${data.message || data.error}`);
        }
    } catch (error) {
        console.error('Erro na requisição:', error);
        resultado.innerHTML = createResultBox('error', `❌ Erro: ${error.message}`);
        showNotification('error', `❌ Erro de conexão: ${error.message}`);
    } finally {
        isProcessing = false;
        button.classList.remove('btn-loading');
        button.textContent = originalText;
    }
}

// Função para remover promoções em lote
async function removerLote() {
    console.log('Função removerLote chamada');
    
    if (isProcessing) {
        showNotification('warning', '⚠️ Já existe um processamento em andamento');
        return;
    }
    
    const mlbIdsText = document.getElementById('mlbIds').value.trim();
    if (!mlbIdsText) {
        showNotification('error', '❌ Digite os MLB IDs');
        return;
    }

    const mlbIds = mlbIdsText.split('\n')
        .map(id => id.trim())
        .filter(id => id);
    
    // Validar todos os IDs
    const idsInvalidos = mlbIds.filter(id => !validarMLBId(id));
    if (idsInvalidos.length > 0) {
        showNotification('error', `❌ IDs inválidos encontrados: ${idsInvalidos.join(', ')}`);
        return;
    }
    
    console.log('MLB IDs para processar:', mlbIds);
    
    const resultado = document.getElementById('resultado');
    const button = event.target;
    const originalText = button.textContent;

    try {
        isProcessing = true;
        button.classList.add('btn-loading');
        button.textContent = 'Iniciando...';
        
        resultado.innerHTML = createResultBox('info', 
            `🚀 Iniciando remoção em lote...\nTotal: ${mlbIds.length} anúncios\n\n${createProgressBar(0)}`
        );

        const response = await fetch('/anuncios/remover-promocoes-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mlb_ids: mlbIds, 
                delay_entre_remocoes: 3000 
            })
        });

        const data = await response.json();
        console.log('Resposta do lote:', data);

        if (data.success) {
            currentProcessId = data.process_id;
            showNotification('info', `🚀 Processamento iniciado (ID: ${data.process_id})`);
            monitorarProgresso(data.process_id);
        } else {
            resultado.innerHTML = createResultBox('error', `❌ Erro: ${data.error}`);
            showNotification('error', `❌ Erro ao iniciar processamento: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro no lote:', error);
        resultado.innerHTML = createResultBox('error', `❌ Erro: ${error.message}`);
        showNotification('error', `❌ Erro de conexão: ${error.message}`);
    } finally {
        button.classList.remove('btn-loading');
        button.textContent = originalText;
    }
}

// Função para verificar status
async function verificarStatus() {
    console.log('Verificando status para:', currentProcessId);
    
    if (!currentProcessId) {
        showNotification('warning', '⚠️ Nenhum processamento ativo');
        return;
    }

    try {
        const response = await fetch(`/anuncios/status-remocao/${currentProcessId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const resultado = document.getElementById('resultado');
        
        const statusInfo = formatarStatusProcessamento(data);
        resultado.innerHTML = createResultBox('info', statusInfo);
        
        showNotification('info', `📊 Status atualizado: ${data.progresso}% concluído`);
        
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        showNotification('error', `❌ Erro ao verificar status: ${error.message}`);
    }
}

// Função para monitorar progresso
function monitorarProgresso(processId) {
    console.log('Iniciando monitoramento para:', processId);
    
    if (monitorInterval) clearInterval(monitorInterval);
    
    monitorInterval = setInterval(async () => {
        try {
            const response = await fetch(`/anuncios/status-remocao/${processId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Atualizar barra de progresso
            const progressFill = document.getElementById('progressFill');
            if (progressFill) {
                progressFill.style.width = data.progresso + '%';
                progressFill.textContent = data.progresso + '%';
            }
            
            // Atualizar informações na tela
            const resultado = document.getElementById('resultado');
            const statusInfo = formatarStatusProcessamento(data);
            resultado.innerHTML = createResultBox('info', statusInfo);

            if (data.status === 'concluido') {
                console.log('Processamento finalizado:', data.status);
                clearInterval(monitorInterval);
                monitorInterval = null;
                isProcessing = false;
                
                // Mostrar resultado final
                const resumo = gerarResumoFinal(data);
                resultado.innerHTML = createResultBox('success', resumo);
                showNotification('success', `✅ Processamento concluído! ${data.sucessos} sucessos, ${data.erros} erros`);
                
            } else if (data.status === 'erro') {
                console.log('Processamento com erro:', data.status);
                clearInterval(monitorInterval);
                monitorInterval = null;
                isProcessing = false;
                showNotification('error', '❌ Processamento interrompido por erro');
            }
            
        } catch (error) {
            console.error('Erro no monitoramento:', error);
            clearInterval(monitorInterval);
            monitorInterval = null;
            isProcessing = false;
        }
    }, 3000);
}

// Função para limpar interface
function limpar() {
    console.log('Limpando interface');
    
    document.getElementById('resultado').innerHTML = '';
    document.getElementById('mlbId').value = '';
    document.getElementById('mlbIds').value = '';
    
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    
    currentProcessId = null;
    isProcessing = false;
    
    showNotification('info', '🧹 Interface limpa');
}

// Função para parar processamento
function pararProcessamento() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    
    isProcessing = false;
    currentProcessId = null;
    
    showNotification('warning', '⏹️ Monitoramento interrompido');
}

// Funções auxiliares
function validarMLBId(mlbId) {
    if (!mlbId) return false;
    const regex = /^MLB\d+$/;
    return regex.test(mlbId.toString().trim());
}

function formatarDetalhesResposta(data) {
    let detalhes = [];
    
    if (data.titulo) detalhes.push(`Anúncio: ${data.titulo}`);
    if (data.mlb_id) detalhes.push(`MLB: ${data.mlb_id}`);
    if (data.message) detalhes.push(`Status: ${data.message}`);
    if (data.preco_antes) detalhes.push(`Preço antes: R$ ${data.preco_antes}`);
    if (data.preco_depois) detalhes.push(`Preço depois: R$ ${data.preco_depois}`);
    if (data.ainda_tem_promocao !== undefined) {
        detalhes.push(`Ainda tem promoção: ${data.ainda_tem_promocao ? 'SIM' : 'NÃO'}`);
    }
    if (data.metodos_tentados && data.metodos_tentados.length > 0) {
        detalhes.push(`Métodos: ${data.metodos_tentados.join(', ')}`);
    }
    
    return detalhes.join('\n');
}

function formatarStatusProcessamento(data) {
    const concluido = data.status === 'concluido' ? 
        `\nConcluído: ${new Date(data.concluido_em).toLocaleString('pt-BR')}` : '';
    
    return `📊 STATUS DO PROCESSAMENTO\n\n` +
        `Process ID: ${data.id}\n` +
        `Status: ${data.status.toUpperCase()}\n` +
        `Progresso: ${data.progresso}%\n` +
        `Processados: ${data.processados}/${data.total_anuncios}\n` +
        `Sucessos: ${data.sucessos}\n` +
        `Erros: ${data.erros}\n` +
        `Iniciado: ${new Date(data.iniciado_em).toLocaleString('pt-BR')}${concluido}\n\n` +
        createProgressBar(data.progresso);
}

function gerarResumoFinal(data) {
    const percentualSucesso = data.total_anuncios > 0 ? 
        Math.round((data.sucessos / data.total_anuncios) * 100) : 0;
    
    return `🎉 PROCESSAMENTO CONCLUÍDO!\n\n` +
        `📊 RESUMO:\n` +
        `• Total processado: ${data.total_anuncios}\n` +
        `• Sucessos: ${data.sucessos} (${percentualSucesso}%)\n` +
        `• Erros: ${data.erros}\n` +
        `• Tempo total: ${calcularTempoProcessamento(data.iniciado_em, data.concluido_em)}\n\n` +
        `✅ Processamento finalizado com sucesso!`;
}

function calcularTempoProcessamento(inicio, fim) {
    const diff = new Date(fim) - new Date(inicio);
    const minutos = Math.floor(diff / 60000);
    const segundos = Math.floor((diff % 60000) / 1000);
    return `${minutos}m ${segundos}s`;
}

function createProgressBar(progresso) {
    return `<div class="progress-bar">
        <div class="progress-fill" id="progressFill" style="width: ${progresso}%">${progresso}%</div>
    </div>`;
}

function createResultBox(type, content, showProgress = false) {
    const progressHtml = showProgress ? createProgressBar(0) : '';
    return `<div class="result ${type}">${content}${progressHtml}</div>`;
}

// Função para mostrar notificações
function showNotification(type, message) {
    // Remover notificações existentes
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());
    
    // Criar nova notificação
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icons[type] || icons.info}</span>
            <span class="notification-message">${message}</span>
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
        padding: 15px;
        max-width: 350px;
        z-index: 1000;
        animation: slideInRight 0.3s ease-out;
        border-left: 4px solid ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#17a2b8'};
    `;
    
    // Adicionar ao DOM
    document.body.appendChild(notification);
    
    // Auto remover após 5 segundos
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Script de remoção inicializado');
    
    // Adicionar validação em tempo real
    const mlbIdInput = document.getElementById('mlbId');
    const mlbIdsTextarea = document.getElementById('mlbIds');
    
    if (mlbIdInput) {
        mlbIdInput.addEventListener('input', function() {
            const value = this.value.trim();
            if (value && !validarMLBId(value)) {
                this.style.borderColor = '#dc3545';
            } else {
                this.style.borderColor = '#28a745';
            }
        });
    }
    
    if (mlbIdsTextarea) {
        mlbIdsTextarea.addEventListener('input', function() {
            const lines = this.value.split('\n').map(line => line.trim()).filter(line => line);
            const invalidLines = lines.filter(line => !validarMLBId(line));
            
            if (invalidLines.length > 0) {
                this.style.borderColor = '#dc3545';
            } else if (lines.length > 0) {
                this.style.borderColor = '#28a745';
            } else {
                this.style.borderColor = '#e9ecef';
            }
        });
    }
    
    // Atalhos de teclado
    document.addEventListener('keydown', function(event) {
        // Ctrl + Enter para remover único
        if (event.ctrlKey && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!isProcessing) removerUnico();
        }
        
        // Ctrl + Shift + Enter para remover lote
        if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            if (!isProcessing) removerLote();
        }
        
        // Escape para limpar
        if (event.key === 'Escape') {
            limpar();
        }
    });
    
    console.log('💡 Atalhos disponíveis:');
    console.log('   Ctrl + Enter: Remover único');
    console.log('   Ctrl + Shift + Enter: Remover lote');
    console.log('   Escape: Limpar interface');
});

// Cleanup ao sair da página
window.addEventListener('beforeunload', function() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
    }
});

// Adicionar estilos para notificações
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .notification-content {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }
    
    .notification-icon {
        font-size: 18px;
        flex-shrink: 0;
    }
    
    .notification-message {
        flex: 1;
        line-height: 1.4;
        color: #333;
        font-size: 14px;
    }
    
    .notification-close {
        background: none;
        border: none;
        font-size: 18px;
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

// Expor funções globalmente
window.removerUnico = removerUnico;
window.removerLote = removerLote;
window.verificarStatus = verificarStatus;
window.limpar = limpar;
window.pararProcessamento = pararProcessamento;

console.log('✅ Todas as funções de remoção carregadas');