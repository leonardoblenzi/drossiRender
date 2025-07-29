const KeywordAnalyticsService = require('../services/keywordAnalyticsService');

class KeywordAnalyticsController {
    /**
     * Busca palavras-chave relacionadas e tendências.
     * @param {Object} req Objeto de requisição.
     * @param {Object} res Objeto de resposta.
     */
    static async getKeywordTrends(req, res) {
        try {
            const { keyword } = req.query; // 'source' não é mais necessário aqui, pois só teremos Trends

            if (!keyword || keyword.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'A palavra-chave é obrigatória.'
                });
            }

            console.log(`🔍 Requisição de tendência de palavra-chave: "${keyword}" (Google Trends)`); // Log ajustado

            // Chamada direta para o Google Trends, sem a necessidade de um 'switch' de fonte
            const results = await KeywordAnalyticsService.getGoogleTrendsKeywordData(keyword);

            // Adicionar metadados da requisição
            results.request_info = {
                keyword_solicitada: keyword,
                fonte_solicitada: 'Google Trends', // Fonte fixa agora
                timestamp: new Date().toISOString(),
                tempo_processamento: Date.now() - req.startTime
            };

            res.json({
                success: true,
                data: results
            });

        } catch (error) {
            console.error('❌ Erro no KeywordAnalyticsController:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor ao buscar tendências de palavra-chave.',
                error: error.message
            });
        }
    }

    /**
     * Limpa o cache.
     * @param {Object} req Objeto de requisição.
     * @param {Object} res Objeto de resposta.
     */
    static async clearKeywordCache(req, res) {
        try {
            KeywordAnalyticsService.clearCache();
            res.json({
                success: true,
                message: 'Cache de palavras-chave limpo com sucesso!',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Erro ao limpar cache de palavras-chave:', error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao limpar cache de palavras-chave.',
                error: error.message
            });
        }
    }
}

module.exports = KeywordAnalyticsController;