const pesquisaDescricaoService = require('../services/pesquisaDescricaoService');
const queueService = require('../services/queueService');

class PesquisaDescricaoController {
    
    // Método original mantido para compatibilidade
    async pesquisar(req, res) {
        try {
            console.log('🚀 Rota /pesquisar chamada');
            console.log('📋 Body:', JSON.stringify(req.body, null, 2));

            const { mlb_ids, detectar_dois_volumes, texto } = req.body;

            // Validação básica
            if (!mlb_ids || !Array.isArray(mlb_ids) || mlb_ids.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'mlb_ids é obrigatório e deve ser um array não vazio'
                });
            }

            console.log('🔍 Verificando método pesquisar...');
            console.log('   Tipo do método pesquisar:', typeof pesquisaDescricaoService.pesquisar);
            console.log('🎯 Método pesquisar chamado!');

            let resultados;

            if (detectar_dois_volumes) {
                console.log('📦 Executando detecção de dois volumes...');
                resultados = await pesquisaDescricaoService.detectarProdutosDoisVolumes(mlb_ids);
            } else if (texto) {
                console.log('🔍 Executando pesquisa por texto...');
                resultados = await pesquisaDescricaoService.pesquisarTextoEmDescricoes(mlb_ids, texto);
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Especifique detectar_dois_volumes=true ou forneça um texto para pesquisar'
                });
            }

            const totalEncontrados = resultados.filter(r => r.encontrado).length;

                        // filtra só mlb + encontrado
            const simples = resultados.map(r => ({
            mlb: r.mlb,
            encontrado: r.encontrado
            }));

            res.json({
            success: true,
            processamento: 'direto',
            resultados: simples,
            total_processados: simples.length,
            total_encontrados: simples.filter(r => r.encontrado).length,
            tempo_processamento: `${((Date.now() - req.startTime) / 1000).toFixed(2)}s`
            });


        } catch (error) {
            console.error('❌ Erro na pesquisa:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Novo método para processamento em massa
    async processarLoteMassa(req, res) {
        try {
            console.log('🚀 Rota /processar-massa chamada');
            console.log('📋 Body:', JSON.stringify(req.body, null, 2));

            const { mlb_ids, detectar_dois_volumes, texto, forca_background = false } = req.body;

            // Validação básica
            if (!mlb_ids || !Array.isArray(mlb_ids) || mlb_ids.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'mlb_ids é obrigatório e deve ser um array não vazio'
                });
            }

            // Validar tipo de processamento
            if (!detectar_dois_volumes && !texto) {
                return res.status(400).json({
                    success: false,
                    message: 'Especifique detectar_dois_volumes=true ou forneça um texto para pesquisar'
                });
            }

            // Validar MLBs
            console.log('🔍 Validando MLBs...');
            const validacao = pesquisaDescricaoService.validarMLBs(mlb_ids);
            
            if (validacao.total_invalidos > 0) {
                return res.status(400).json({
                    success: false,
                    message: `${validacao.total_invalidos} MLBs inválidos encontrados`,
                    mlbs_invalidos: validacao.invalidos.slice(0, 10), // Mostrar apenas os primeiros 10
                    total_invalidos: validacao.total_invalidos
                });
            }

            console.log(`✅ ${validacao.total_validos} MLBs válidos encontrados`);

            // Decidir se processa diretamente ou em background
            const limite_direto = 50; // Processar até 50 MLBs diretamente
            const usar_background = forca_background || mlb_ids.length > limite_direto;

            if (!usar_background) {
                console.log('📦 Lote pequeno, processando diretamente...');
                
                let resultados;
                const startTime = Date.now();

                if (detectar_dois_volumes) {
                    resultados = await pesquisaDescricaoService.detectarProdutosDoisVolumes(validacao.validos);
                } else {
                    resultados = await pesquisaDescricaoService.pesquisarTextoEmDescricoes(validacao.validos, texto);
                }

                const totalEncontrados = resultados.filter(r => r.encontrado).length;
                const tempoProcessamento = ((Date.now() - startTime) / 1000).toFixed(2);

                const simples = resultados.map(r => ({
                    mlb: r.mlb,
                    encontrado: r.encontrado
                }));
                const achados = simples.filter(r => r.encontrado).length;

                return res.json({
                    success: true,
                    processamento: 'direto',
                    resultados: simples,
                    total_processados: simples.length,
                    total_encontrados: achados,
                    tempo_processamento: `${tempoProcessamento}s`,
                    estatisticas: {
                    taxa_sucesso: Math.round((simples.length / validacao.total_validos) * 100),
                    taxa_deteccao: simples.length ? Math.round((achados / simples.length) * 100) : 0
                    }
                });

            }

            // Processamento em background
            console.log('📦 Lote grande, usando sistema de filas...');
            
            const opcoes = {
                tipo_processamento: detectar_dois_volumes ? 'detectar_dois_volumes' : 'pesquisar_texto',
                texto: texto || null,
                detectar_dois_volumes: detectar_dois_volumes || false,
                criado_por: req.ip || 'unknown',
                user_agent: req.get('User-Agent') || 'unknown'
            };

            const job = await queueService.adicionarLoteMLBs(validacao.validos, opcoes);

            res.json({
                success: true,
                processamento: 'background',
                job_id: job.job_id,
                total_adicionados: job.total_adicionados,
                tempo_estimado_horas: job.tempo_estimado_horas,
                inicio_estimado: job.inicio_estimado,
                fim_estimado: job.fim_estimado,
                urls: {
                    status: `/api/pesquisa-descricao/status/${job.job_id}`,
                    download: `/api/pesquisa-descricao/download/${job.job_id}`,
                    dashboard: `/dashboard/jobs/${job.job_id}`
                },
                message: 'Processamento iniciado em background. Use o job_id para acompanhar o progresso.'
            });

        } catch (error) {
            console.error('❌ Erro no processamento em massa:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    // Consultar status de um job específico
    async consultarStatusJob(req, res) {
        try {
            const { job_id } = req.params;
            
            if (!job_id) {
                return res.status(400).json({
                    success: false,
                    message: 'job_id é obrigatório'
                });
            }

            console.log(`📊 Consultando status do job: ${job_id}`);
            
            const status = await queueService.obterStatusJob(job_id);
            const estatisticas = await queueService.obterEstatisticasJob(job_id);
            
            res.json({
                success: true,
                status: {
                    ...status,
                    estatisticas
                }
            });

        } catch (error) {
            console.error(`❌ Erro ao consultar status do job:`, error);
            
            if (error.message.includes('não encontrado')) {
                return res.status(404).json({
                    success: false,
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Listar todos os jobs
    async listarJobs(req, res) {
        try {
            const { limite = 20, status_filtro } = req.query;
            
            console.log('📋 Listando jobs...');
            
            let jobs = await queueService.listarJobsAtivos();
            
            // Filtrar por status se especificado
            if (status_filtro) {
                jobs = jobs.filter(job => job.status === status_filtro);
            }

            // Limitar resultados
            jobs = jobs.slice(0, parseInt(limite));

            // Obter estatísticas gerais
            const estatisticasGerais = await queueService.obterEstatisticas();

            res.json({
                success: true,
                jobs,
                total_jobs: jobs.length,
                estatisticas_gerais: estatisticasGerais,
                filtros_aplicados: {
                    limite: parseInt(limite),
                    status_filtro: status_filtro || 'todos'
                }
            });

        } catch (error) {
            console.error('❌ Erro ao listar jobs:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }    // Baixar resultados de um job
        // Baixar resultados de um job (JSONL padrão ou TXT on-the-fly)
    async baixarResultados(req, res) {
        try {
            const { job_id, arquivo } = req.params;
            const { formato, format, txt } = req.query || {};
            if (!job_id) {
                return res.status(400).json({ success: false, message: 'job_id é obrigatório' });
            }

            const fs = require('fs');
            const path = require('path');

            const querTxt = (arquivo && arquivo.toLowerCase().endsWith('.txt')) 
                         || (String(formato).toLowerCase() === 'txt') 
                         || (String(format).toLowerCase() === 'txt') 
                         || (txt === '1');

            // Se pedirem .txt, geramos a partir do JSONL salvo
            if (querTxt) {
                const jsonlPath = path.join(__dirname, '../results', `${job_id}_resultados.jsonl`);
                if (!fs.existsSync(jsonlPath)) {
                    return res.status(404).json({ success: false, message: 'JSONL de resultados não encontrado', job_id });
                }
                const linhas = fs.readFileSync(jsonlPath, 'utf8')
                    .split(/\r?\n/).filter(Boolean)
                    .map((ln) => {
                        try {
                            const r = JSON.parse(ln);
                            const det = r?.deteccao_dois_volumes || {};
                            const volumes = det.detectado ? '02' : '00';
                            const padrao  = det.padrao_detectado || '';
                            const trecho  = (det.trecho_detectado || '').replace(/\s+/g, ' ').trim();
                            return `${r.mlb || r.mlb_id};${r.encontrado ? 'SIM' : 'NAO'};${volumes};${padrao};${trecho}`;
                        } catch { return ''; }
                    });

                const txtOut = ['MLB;ENCONTRADO;VOLUMES;PADRAO;TRECHO', ...linhas.filter(Boolean)].join('\n');
                const fileName = arquivo && arquivo.toLowerCase().endsWith('.txt') ? arquivo : `${job_id}_resultados.txt`;
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                return res.send(txtOut);
            }

            // Baixar arquivo físico (padrão JSONL)
            let nomeArquivo = arquivo || `${job_id}_resultados.jsonl`;
            const caminhoArquivo = path.join(__dirname, '../results', nomeArquivo);

            if (!fs.existsSync(caminhoArquivo)) {
                return res.status(404).json({ success: false, message: 'Arquivo não encontrado', arquivo_solicitado: nomeArquivo, job_id });
            }

            const stats = fs.statSync(caminhoArquivo);
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', stats.size);
            return res.download(caminhoArquivo);
        } catch (error) {
            console.error('❌ Erro no download:', error);
            return res.status(500).json({ success: false, message: 'Erro ao baixar resultados', error: error.message });
        }
    }

    // Cancelar job
    async cancelarJob(req, res) {
        try {
            const { job_id } = req.params;
            
            if (!job_id) {
                return res.status(400).json({
                    success: false,
                    message: 'job_id é obrigatório'
                });
            }

            console.log(`🚫 Cancelando job: ${job_id}`);
            
            const resultado = await queueService.cancelarJob(job_id);
            
            res.json({
                success: true,
                message: resultado.message,
                jobs_cancelados: resultado.jobs_cancelados,
                job_id
            });

        } catch (error) {
            console.error(`❌ Erro ao cancelar job:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Reprocessar erros de um job
    async reprocessarErros(req, res) {
        try {
            const { job_id } = req.params;
            
            if (!job_id) {
                return res.status(400).json({
                    success: false,
                    message: 'job_id é obrigatório'
                });
            }

            console.log(`🔄 Reprocessando erros do job: ${job_id}`);
            
            const resultado = await queueService.reprocessarErros(job_id);
            
            if (!resultado.sucesso) {
                return res.status(400).json({
                    success: false,
                    message: resultado.message
                });
            }

            res.json({
                success: true,
                message: resultado.message,
                job_original: resultado.job_original,
                novo_job_id: resultado.novo_job_id,
                mlbs_reprocessar: resultado.mlbs_reprocessar,
                urls: {
                    status_novo_job: `/api/pesquisa-descricao/status/${resultado.novo_job_id}`,
                    dashboard_novo_job: `/dashboard/jobs/${resultado.novo_job_id}`
                }
            });

        } catch (error) {
            console.error(`❌ Erro ao reprocessar erros:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Obter resultados parciais de um job
    async obterResultadosParciais(req, res) {
        try {
            const { job_id } = req.params;
            const { limite = 100, offset = 0 } = req.query;
            
            if (!job_id) {
                return res.status(400).json({
                    success: false,
                    message: 'job_id é obrigatório'
                });
            }

            console.log(`📄 Obtendo resultados parciais - Job: ${job_id}, Limite: ${limite}, Offset: ${offset}`);
            
            const resultados = await queueService.obterResultadosParciais(job_id, parseInt(limite));
            
            res.json({
                success: true,
                job_id,
                resultados: resultados.resultados,
                total_resultados: resultados.total_resultados,
                resultados_retornados: resultados.resultados_retornados,
                limite: parseInt(limite),
                offset: parseInt(offset)
            });

        } catch (error) {
            console.error(`❌ Erro ao obter resultados parciais:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Pausar/Retomar processamento global
    async controlarProcessamento(req, res) {
        try {
            const { acao } = req.params; // 'pausar' ou 'retomar'
            
            if (!['pausar', 'retomar'].includes(acao)) {
                return res.status(400).json({
                    success: false,
                    message: 'Ação deve ser "pausar" ou "retomar"'
                });
            }

            console.log(`⏯️ ${acao.charAt(0).toUpperCase() + acao.slice(1)} processamento...`);
            
            if (acao === 'pausar') {
                await queueService.pausarJob();
            } else {
                await queueService.retomarJob();
            }

            res.json({
                success: true,
                message: `Processamento ${acao === 'pausar' ? 'pausado' : 'retomado'} com sucesso`,
                acao,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ Erro ao ${req.params.acao} processamento:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Limpar jobs antigos
    async limparJobsAntigos(req, res) {
        try {
            const { dias = 7 } = req.query;
            
            console.log(`🧹 Limpando jobs mais antigos que ${dias} dias...`);
            
            await queueService.limparJobsAntigos(parseInt(dias));
            
            res.json({
                success: true,
                message: `Jobs mais antigos que ${dias} dias foram removidos`,
                dias_mantidos: parseInt(dias),
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erro ao limpar jobs antigos:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Estatísticas gerais do sistema
    async obterEstatisticasGerais(req, res) {
        try {
            console.log('📊 Obtendo estatísticas gerais...');
            
            const estatisticas = await queueService.obterEstatisticas();
            const jobs = await queueService.listarJobsAtivos();
            
            // Calcular estatísticas adicionais
            const jobsPorStatus = jobs.reduce((acc, job) => {
                acc[job.status] = (acc[job.status] || 0) + 1;
                return acc;
            }, {});

            const totalMLBsProcessando = jobs
                .filter(job => job.status === 'processando')
                .reduce((acc, job) => acc + job.total_mlbs, 0);

            res.json({
                success: true,
                estatisticas: {
                    fila: estatisticas,
                    jobs: {
                        total_jobs_ativos: jobs.length,
                        por_status: jobsPorStatus,
                        total_mlbs_processando: totalMLBsProcessando
                    },
                    sistema: {
                        timestamp: new Date().toISOString(),
                        uptime: process.uptime(),
                        memoria_usada: process.memoryUsage()
                    }
                }
            });

        } catch (error) {
            console.error('❌ Erro ao obter estatísticas gerais:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }

    // Método para buscar MLBs válidos (mantido do original)
    async buscarMLBs(req, res) {
        try {
            const { termo, limite = 10 } = req.query;

            if (!termo) {
                return res.status(400).json({
                    success: false,
                    message: 'Parâmetro "termo" é obrigatório'
                });
            }

            console.log(`🔍 Buscando MLBs com termo: "${termo}", limite: ${limite}`);

            const mlbs = await pesquisaDescricaoService.buscarMLBsValidos(termo, parseInt(limite));

            res.json({
                success: true,
                termo_pesquisado: termo,
                limite: parseInt(limite),
                total_encontrados: mlbs.length,
                mlbs
            });

        } catch (error) {
            console.error('❌ Erro na busca de MLBs:', error);
            res.status(500).json({
                success: false,
                message: 'Erro interno do servidor',
                error: error.message
            });
        }
    }
}

module.exports = new PesquisaDescricaoController();