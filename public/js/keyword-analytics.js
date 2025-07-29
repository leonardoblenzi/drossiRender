// public/js/keyword-analytics.js

// Variáveis globais
let currentKeywordData = null;

/**
 * Dispara a busca de tendências para a palavra-chave.
 */
async function searchKeywordTrends() {
    const keywordInput = document.getElementById('searchKeyword');
    const keyword = keywordInput.value.trim();

    if (!keyword) {
        alert('Por favor, digite uma palavra-chave para buscar.');
        return;
    }

    showLoading(true);
    hideErrorMessage();
    hideResults();

    try {
        // A requisição agora é sempre para a rota de 'trends' e não precisa de parâmetro 'source'
        const response = await fetch(`/api/keyword-analytics/trends?keyword=${encodeURIComponent(keyword)}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Erro desconhecido ao buscar tendências.');
        }

        currentKeywordData = result.data;
        displayResults(currentKeywordData);

    } catch (error) {
        console.error('❌ Erro na busca de palavras-chave:', error);
        showErrorMessage(`Erro ao buscar tendências: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

/**
 * Exibe os resultados da busca na interface.
 * @param {Object} data Os dados retornados pelo backend.
 */
function displayResults(data) {
    const resultHeader = document.getElementById('resultHeader');
    const keywordList = document.getElementById('keywordList');

    resultHeader.innerHTML = `
        <h2>Resultados para "${data.mainKeyword}" (${data.source})</h2>
        ${data.message ? `<p class="info-message">${data.message}</p>` : ''}
    `;

    if (data.relatedKeywords && data.relatedKeywords.length > 0) {
        keywordList.innerHTML = data.relatedKeywords.map((item, index) => {
            let details = '';
            
            // Detalhes específicos do Google Trends
            details += `<span>Interesse: <strong>${item.interest || 'N/A'}</strong></span>`;
            details += `<span>Tendência: <span class="trend-${item.trend || 'estavel'}">
                            ${item.trend === 'crescendo' ? '📈' : item.trend === 'declinando' ? '📉' : '➡️'}
                            ${item.trend || 'estavel'}
                        </span></span>`;
            
            const sourceDisplay = 'Google Trends'; // Fonte fixa agora

            return `
                <div class="keyword-item">
                    <span class="ranking">#${index + 1}</span>
                    <h3>${item.keyword}</h3>
                    <div class="keyword-details">
                        ${details}
                    </div>
                     <div class="keyword-sources">Fonte: ${sourceDisplay}</div>
                </div>
            `;
        }).join('');
    } else {
        keywordList.innerHTML = '<p class="no-results">Nenhuma palavra-chave relacionada encontrada.</p>';
    }

    document.getElementById('results').style.display = 'block';
}

/**
 * Limpa o cache de palavras-chave no backend.
 * @param {Event} event O evento de clique (opcional)
 */
async function clearKeywordCache(event) {
    // Adicionado para evitar recarregar a página se o botão estiver em um formulário
    if (event) event.preventDefault(); 

    try {
        const response = await fetch('/api/keyword-analytics/clear-cache', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
        } else {
            throw new Error(result.message || 'Erro ao limpar cache.');
        }
    } catch (error) {
        console.error('❌ Erro ao limpar cache:', error);
        alert(`Erro ao limpar cache: ${error.message}`);
    }
}

/**
 * Funções auxiliares para UI
 */
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showErrorMessage(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.innerHTML = `❌ ${message}`;
    errorDiv.style.display = 'block';
}

function hideErrorMessage() {
    document.getElementById('errorMessage').style.display = 'none';
}

function hideResults() {
    document.getElementById('results').style.display = 'none';
}

// Opcional: Acionar busca ao pressionar Enter no campo de texto
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                searchKeywordTrends();
            }
        });
    }
});