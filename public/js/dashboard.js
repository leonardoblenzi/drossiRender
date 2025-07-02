// Dashboard JavaScript
console.log('Dashboard script carregado');

// Variáveis globais
let isProcessing = false;

// Função para verificar token
async function verificarToken() {
    if (isProcessing) return;
    
    const button = event.target;
    const originalText = button.textContent;
    
    try {
        isProcessing = true;
        button.classList.add('btn-loading');
        button.textContent = 'Verificando...';
        
        const response = await fetch('/verificar-token');
        const data = await response.json();
        
        if (data.success) {
            showNotification('success', `✅ ${data.message}\nUser: ${data.nickname}\nToken: ${data.token_preview}`);
        } else {
            showNotification('error', `❌ ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao verificar token:', error);
        showNotification('error', `❌ Erro: ${error.message}`);
    } finally {
        isProcessing = false;
        button.classList.remove('btn-loading');
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
        button.classList.add('btn-loading');
        button.textContent = 'Renovando...';
        
        const response = await fetch('/renovar-token-automatico', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('success', `✅ ${data.message}\nUser: ${data.nickname}\nNovo token: ${data.access_token.substring(0, 20)}...`);
        } else {
            showNotification('error', `❌ ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao renovar token:', error);
        showNotification('error', `❌ Erro: ${error.message}`);
    } finally {
        isProcessing = false;
        button.classList.remove('btn-loading');
        button.textContent = originalText;
    }
}

// Função para mostrar notificações modernas
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
            <span class="notification-message">${message.replace(/\n/g, '<br>')}</span>
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

// Adicionar estilos CSS para notificações
const notificationStyles = document.createElement('style');
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
        const response = await fetch('/test');
        if (response.ok) {
            console.log('✅ Servidor funcionando');
            return true;
        }
    } catch (error) {
        console.error('❌ Servidor não está respondendo:', error);
        return false;
    }
}

// Função para obter estatísticas do dashboard
async function obterEstatisticas() {
    try {
        const response = await fetch('/debug/routes');
        if (response.ok) {
            const data = await response.json();
            console.log(`📊 Total de rotas disponíveis: ${data.total_routes}`);
            return data;
        }
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
    }
}

// Função para atualizar indicadores de status
function atualizarIndicadoresStatus() {
    const statusElements = document.querySelectorAll('.status');
    
    statusElements.forEach(element => {
        if (element.classList.contains('warning')) {
            element.style.animation = 'pulse 2s ease-in-out infinite';
        }
    });
}

// Função para verificar se há atualizações disponíveis
async function verificarAtualizacoes() {
    // Esta função pode ser expandida para verificar atualizações
    console.log('🔍 Verificando atualizações...');
}

// Inicialização quando a página carrega
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Dashboard inicializado');
    
    // Verificar status do servidor
    verificarStatusServidor();
    
    // Obter estatísticas
    obterEstatisticas();
    
    // Atualizar indicadores
    atualizarIndicadoresStatus();
    
    // Verificar atualizações
    verificarAtualizacoes();
    
    // Adicionar listeners para teclas de atalho
    document.addEventListener('keydown', function(event) {
        // Ctrl + R para renovar token
        if (event.ctrlKey && event.key === 'r') {
            event.preventDefault();
            renovarToken();
        }
        
        // Ctrl + T para verificar token
        if (event.ctrlKey && event.key === 't') {
            event.preventDefault();
            verificarToken();
        }
    });
    
    console.log('💡 Atalhos disponíveis:');
    console.log('   Ctrl + R: Renovar token');
    console.log('   Ctrl + T: Verificar token');
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
    
    showNotification('info', ajuda);
}

// Expor funções globalmente para uso nos botões HTML
window.verificarToken = verificarToken;
window.renovarToken = renovarToken;
window.mostrarAjuda = mostrarAjuda;

console.log('✅ Todas as funções do dashboard carregadas');