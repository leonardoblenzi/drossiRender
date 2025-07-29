const googleTrends = require('google-trends-api');

class KeywordAnalyticsService {
    static config = {
        googleTrends: { // Configuração específica para o Google Trends
            hl: 'pt-BR', // Idioma de exibição
            geo: 'BR',   // País (Brasil)
            timezone: -180, // GMT-3 (Brasília) em minutos: -3 * 60 = -180
            category: 0 // Todas as categorias (0 para todas). Você pode especificar, e.g., 'Home & Garden': 286
        }
    };

    /**
     * Busca dados de tendências do Google Trends para a palavra-chave.
     * Este método é agora o único método de busca neste serviço.
     * @param {string} keyword A palavra-chave principal.
     * @returns {Promise<Object>} Dados de palavras-chave relacionadas do Google Trends.
     */
    static async getGoogleTrendsKeywordData(keyword) {
        console.log(`📈 Buscando Google Trends para: "${keyword}"`);

        try {
            // Obter interesse ao longo do tempo para a palavra-chave principal
            const interestOverTime = await googleTrends.interestOverTime({
                keyword: keyword,
                startTime: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)), // Últimos 30 dias (ajustável)
                endTime: new Date(),
                geo: this.config.googleTrends.geo,
                hl: this.config.googleTrends.hl,
                timezone: this.config.googleTrends.timezone,
                category: this.config.googleTrends.category
            });
            const interestData = JSON.parse(interestOverTime);
            
            // Obter consultas relacionadas
            const relatedQueries = await googleTrends.relatedQueries({
                keyword: keyword,
                geo: this.config.googleTrends.geo,
                hl: this.config.googleTrends.hl,
                timezone: this.config.googleTrends.timezone,
                category: this.config.googleTrends.category
            });
            const relatedQueriesData = JSON.parse(relatedQueries);

            // Processar dados de interesse ao longo do tempo para tendência da palavra principal
            let trendMainKeyword = 'estavel';
            if (interestData.default && interestData.default.timelineData && interestData.default.timelineData.length > 0) {
                const values = interestData.default.timelineData.map(d => d.value[0]);
                if (values.length > 7) { 
                    const firstWeekAvg = values.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
                    const lastWeekAvg = values.slice(-7).reduce((a, b) => a + b, 0) / 7;
                    const change = ((lastWeekAvg - firstWeekAvg) / (firstWeekAvg || 1)) * 100; 

                    if (change > 10) trendMainKeyword = 'crescendo';
                    else if (change < -10) trendMainKeyword = 'declinando';
                }
            }
            
            // Construir lista de palavras-chave relacionadas
            const keywords = [];

            // Adicionar a palavra-chave principal
            keywords.push({
                keyword: keyword,
                interest: interestData.default.timelineData && interestData.default.timelineData.length > 0
                          ? interestData.default.timelineData[interestData.default.timelineData.length - 1].value[0] 
                          : 0,
                trend: trendMainKeyword,
                isMainKeyword: true
            });

            // Adicionar as consultas relacionadas (top e em ascensão)
            if (relatedQueriesData.default && relatedQueriesData.default.rankedList) {
                relatedQueriesData.default.rankedList.forEach(list => {
                    list.rankedKeyword.forEach(item => {
                        keywords.push({
                            keyword: item.query,
                            value: item.value, 
                            extractedValue: item.extractedValue,
                            interest: item.value,
                            trend: item.extractedValue === 'Breakout' ? 'crescendo' : 'estavel', 
                            fromTrends: true // Mantém a flag para indicar a fonte se for usar no futuro para híbrido
                        });
                    });
                });
            }

            const uniqueKeywords = Array.from(new Map(keywords.map(item => [item.keyword, item])).values())
                                    .sort((a, b) => b.interest - a.interest)
                                    .slice(0, 20); 

            return {
                source: 'Google Trends', // A fonte agora é sempre Google Trends
                mainKeyword: keyword,
                relatedKeywords: uniqueKeywords
            };

        } catch (error) {
            console.error('❌ Erro na integração com Google Trends API:', error.message);
            throw new Error(`Erro ao obter dados do Google Trends: ${error.message}`);
        }
    }

    // Removidos os métodos getMLKeywordData e getHybridKeywordData completamente.

    static clearCache() {
        // Implementar lógica de limpeza de cache se usar um sistema de cache como Redis
        console.log('🗑️ Cache (simulado) limpo.');
    }
}

module.exports = KeywordAnalyticsService;