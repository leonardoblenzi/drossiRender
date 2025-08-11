const PesquisaDescricaoService = require('../services/pesquisaDescricaoService');

console.log('🔄 Carregando PesquisaDescricaoController...');

class PesquisaDescricaoController {
    constructor() {
        console.log('🏗️ Construindo PesquisaDescricaoController...');
    }

    async pesquisar(req, res) {
        console.log('🎯 Método pesquisar chamado!');
        try {
            const { mlb_ids, texto, detectar_dois_volumes } = req.body;

            if (!mlb_ids || !Array.isArray(mlb_ids) || mlb_ids.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'É necessário fornecer uma lista de MLB IDs válida'
                });
            }

            if (!detectar_dois_volumes && !texto) {
                return res.status(400).json({
                    success: false,
                    message: 'É necessário ativar pelo menos uma opção: detectar_dois_volumes ou fornecer texto para pesquisa'
                });
            }

            if (detectar_dois_volumes && texto) {
                return res.status(400).json({
                    success: false,
                    message: 'Não é possível usar detecção de dois volumes e pesquisa de texto simultaneamente.'
                });
            }

            const inicio = Date.now();
            let resultados;

            if (detectar_dois_volumes) {
                console.log('📦 Executando detecção de dois volumes...');
                resultados = await PesquisaDescricaoService.detectarProdutosDoisVolumes(mlb_ids);
            } else {
                console.log('🔍 Executando pesquisa de texto...');
                if (!texto || texto.trim().length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Texto para pesquisa é obrigatório quando não estiver usando detecção de dois volumes'
                    });
                }
                resultados = await PesquisaDescricaoService.pesquisarTextoEmDescricoes(mlb_ids, texto.trim());
            }

            const fim = Date.now();
            const tempoExecucao = `${((fim - inicio) / 1000).toFixed(2)}s`;

            const totalProcessados = resultados.length;
            let totalEncontrados;

            if (detectar_dois_volumes) {
                totalEncontrados = resultados.filter(r => 
                    r.deteccao_dois_volumes && r.deteccao_dois_volumes.detectado
                ).length;
            } else {
                totalEncontrados = resultados.filter(r => r.encontrado).length;
            }

            console.log(`✅ Pesquisa concluída: ${totalEncontrados}/${totalProcessados} encontrados em ${tempoExecucao}`);

            res.json({
                success: true,
                resultados,
                total_processados: totalProcessados,
                total_encontrados: totalEncontrados,
                tempo_execucao: tempoExecucao,
                tipo_pesquisa: detectar_dois_volumes ? 'deteccao_dois_volumes' : 'pesquisa_texto'
            });

        } catch (error) {
            console.error('❌ Erro no controller:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    async teste(req, res) {
        console.log('�� Método teste chamado!');
        res.json({
            message: 'Controller funcionando!',
            timestamp: new Date().toISOString(),
            metodos_disponiveis: ['pesquisar', 'teste']
        });
    }
}

const instance = new PesquisaDescricaoController();
console.log('✅ PesquisaDescricaoController criado com sucesso');
console.log('📋 Métodos da instância:', Object.getOwnPropertyNames(Object.getPrototypeOf(instance)));

module.exports = instance;