const Bull = require('bull');
const fs = require('fs').promises;
const path = require('path');

class QueueService {
    constructor() {
        // Configurar Redis (você precisa ter Redis instalado)
        this.mlbQueue = new Bull('MLB Processing Queue', {
            redis: {
                port: 6379,
                host: '127.0.0.1',
                // Se usar Redis na nuvem:
                // host: 'seu-redis-host.com',
                // password: 'sua-senha'
            }
        });

        this.setupProcessors();
        this.setupEventListeners();
        
        // Criar diretório de resultados se não existir
        this.ensureResultsDirectory();
    }
    
    async ensureResultsDirectory() {
        const resultsDir = path.join(__dirname, '../results');
        try {
            await fs.access(resultsDir);
        } catch {
            await fs.mkdir(resultsDir, { recursive: true });
        }
    }

    setupProcessors() {
        // Processar 1 MLB por vez (evita sobrecarga)
        this.mlbQueue.process('processar-mlb', 1, async (job) => {
            const { mlb, tipo_processamento, job_id, index, total } = job.data;
            
            console.log(`🔄 Processando ${index + 1}/${total}: ${mlb}`);
            
            // Atualizar progresso
            job.progress(Math.round(((index + 1) / total) * 100));

            try {
                const pesquisaService = require('./pesquisaDescricaoService');
                let resultado;

                if (tipo_processamento === 'detectar_dois_volumes') {
                    const resultados = await pesquisaService.detectarProdutosDoisVolumes([mlb]);
                    resultado = resultados[0];
                } else if (tipo_processamento === 'pesquisar_texto') {
                    const resultados = await pesquisaService.pesquisarTextoEmDescricoes([mlb], job.data.texto);
                    resultado = resultados[0];
                }

                // Salvar resultado individual
                await this.salvarResultado(job_id, mlb, resultado, 'success');
                
                console.log(`✅ ${mlb} processado com sucesso`);
                return resultado;

            } catch (error) {
                console.error(`❌ Erro ao processar ${mlb}:`, error.message);
                await this.salvarResultado(job_id, mlb, null, 'error', error.message);
                throw error;
            }
        });
    }

    setupEventListeners() {
        this.mlbQueue.on('completed', (job, result) => {
            console.log(`✅ Job ${job.id} concluído: ${job.data.mlb}`);
        });

        this.mlbQueue.on('failed', (job, err) => {
            console.log(`❌ Job ${job.id} falhou: ${job.data.mlb} - ${err.message}`);
        });

        this.mlbQueue.on('progress', (job, progress) => {
            console.log(`📊 Job ${job.id}: ${progress}% concluído`);
        });
    }

    // NOVA FUNÇÃO: Verificar conexão Redis
    async verificarConexao() {
        try {
            await this.mlbQueue.client.ping();
            console.log('✅ Conexão Redis estabelecida');
            return true;
        } catch (error) {
            console.error('❌ Erro na conexão Redis:', error.message);
            return false;
        }
    }

    // NOVA FUNÇÃO: Inicializar processamento
    async iniciarProcessamento() {
        try {
            console.log('🚀 Iniciando sistema de processamento...');
            
            // Verificar conexão Redis
            const redisOk = await this.verificarConexao();
            if (!redisOk) {
                throw new Error('Falha na conexão com Redis');
            }
            
            // Limpar jobs antigos automaticamente
            await this.limparJobsAntigos(7);
            
            // Retomar processamento se estava pausado
            await this.retomarJob();
            
            console.log('✅ Sistema de processamento iniciado com sucesso');
            return true;
        } catch (error) {
            console.error('❌ Erro ao iniciar processamento:', error.message);
            throw error;
        }
    }

    // NOVA FUNÇÃO: Configurar processadores
    configurarProcessadores() {
        console.log('⚙️ Processadores configurados');
        // Os processadores já estão configurados no setupProcessors()
    }

    async adicionarLoteMLBs(mlbs, opcoes = {}) {
        const job_id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        console.log(`📦 Criando job ${job_id} para ${mlbs.length} MLBs`);

        // Criar arquivo de metadados do job
        await this.criarMetadataJob(job_id, mlbs.length, opcoes);

        // Criar jobs individuais para cada MLB
        const jobs = mlbs.map((mlb, index) => ({
            name: 'processar-mlb',
            data: {
                mlb,
                job_id,
                index,
                total: mlbs.length,
                tipo_processamento: opcoes.tipo_processamento || 'detectar_dois_volumes',
                texto: opcoes.texto || null
            },
            opts: {
                delay: index * 2000, // 2 segundos entre cada MLB
                attempts: 3, // Tentar 3 vezes se falhar
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: 100, // Manter apenas os últimos 100 jobs concluídos
                removeOnFail: 50 // Manter apenas os últimos 50 jobs falhados
            }
        }));

        await this.mlbQueue.addBulk(jobs);
        
        return {
            job_id,
            total_adicionados: mlbs.length,
            tempo_estimado_horas: Math.round((mlbs.length * 2) / 3600 * 100) / 100,
            inicio_estimado: new Date().toISOString(),
            fim_estimado: new Date(Date.now() + (mlbs.length * 2000)).toISOString()
        };
    }

    async criarMetadataJob(job_id, total_mlbs, opcoes) {
        const metadata = {
            job_id,
            total_mlbs,
            opcoes,
            criado_em: new Date().toISOString(),
            status: 'iniciado',
            processados: 0,
            sucessos: 0,
            erros: 0
        };

        const arquivo = path.join(__dirname, '../results', `${job_id}_metadata.json`);
        await fs.writeFile(arquivo, JSON.stringify(metadata, null, 2));
    }

    async atualizarMetadataJob(job_id, updates) {
        try {
            const arquivo = path.join(__dirname, '../results', `${job_id}_metadata.json`);
            const metadata = JSON.parse(await fs.readFile(arquivo, 'utf8'));
            
            Object.assign(metadata, updates);
            metadata.atualizado_em = new Date().toISOString();
            
            await fs.writeFile(arquivo, JSON.stringify(metadata, null, 2));
        } catch (error) {
            console.error('Erro ao atualizar metadata:', error);
        }
    }

   async obterStatusJob(job_id) {
  // lê metadata
  const metaPath = path.join(__dirname, '../results', `${job_id}_metadata.json`);
  const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));

  // pega contagens da fila
  const [waiting, active, completed, failed] = await Promise.all([
    this.mlbQueue.getWaiting(),
    this.mlbQueue.getActive(),
    this.mlbQueue.getCompleted(),
    this.mlbQueue.getFailed()
  ]);
  const filterByJob = arr => arr.filter(j => j.data.job_id === job_id).length;
  const aguardando = filterByJob(waiting);
  const processando = filterByJob(active);
  const concluidos = filterByJob(completed);
  const falharam = filterByJob(failed);
  const totalJobs = aguardando + processando + concluidos + falharam;
  const progresso = totalJobs > 0
    ? Math.round(((concluidos + falharam) / totalJobs) * 100)
    : 0;

  // obtem resultados detalhados para calcular taxas
  const { total_resultados, resultados } = await this.obterResultadosParciais(job_id, 999999);
  const sucessos = resultados.filter(r => r.status === 'success').length;
  const encontrados = resultados.filter(r => r.encontrado).length;

  return {
    job_id,
    status: progresso === 100
      ? 'concluido'
      : processando > 0
        ? 'processando'
        : 'aguardando',
    progresso_percentual: progresso,
    total_mlbs: metadata.total_mlbs,
    aguardando,
    processando,
    concluidos,
    falharam,
    criado_em: metadata.criado_em,
    tempo_decorrido: this.calcularTempoDecorrido(metadata.criado_em),
    tempo_estimado_restante: this.calcularTempoRestante(aguardando + processando),
    total_processados: total_resultados,
    total_sucessos: sucessos,
    total_encontrados: encontrados,
    taxa_sucesso: total_resultados > 0 ? Math.round((sucessos / total_resultados) * 100) : 0,
    taxa_deteccao: total_resultados > 0 ? Math.round((encontrados / total_resultados) * 100) : 0,
    arquivos_disponiveis: await this.listarArquivosJob(job_id)
  };
}


    calcularTempoDecorrido(inicio) {
        const agora = new Date();
        const inicioDate = new Date(inicio);
        const diffMs = agora - inicioDate;
        
        const horas = Math.floor(diffMs / (1000 * 60 * 60));
        const minutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${horas}h ${minutos}m`;
    }

    calcularTempoRestante(itemsRestantes) {
        const segundosRestantes = itemsRestantes * 2; // 2 segundos por item
        const horas = Math.floor(segundosRestantes / 3600);
        const minutos = Math.floor((segundosRestantes % 3600) / 60);
        
        return `${horas}h ${minutos}m`;
    }

    async listarArquivosJob(job_id) {
        try {
            const resultsDir = path.join(__dirname, '../results');
            const files = await fs.readdir(resultsDir);
            
            const jobFiles = files.filter(file => file.startsWith(job_id));
            
            return jobFiles.map(file => ({
                nome: file,
                tipo: file.includes('_errors') ? 'erros' : file.includes('_metadata') ? 'metadata' : 'resultados',
                url: `/api/pesquisa-descricao/download/${job_id}/${file}`
            }));
        } catch (error) {
            return [];
        }
    }

   async salvarResultado(job_id, mlb, resultado, status, erro = null) {
  // Só mantemos MLB + encontrado (boolean)
  const linhaData = {
    mlb,
    encontrado: status === 'success' && !!resultado?.encontrado
  }
  const linha = JSON.stringify(linhaData) + '\n'

  // salva no arquivo principal
  const arquivo = path.join(__dirname, '../results', `${job_id}_resultados.jsonl`)
  await fs.appendFile(arquivo, linha)

  // Se quiser manter o arquivo de erros separado, faça a mesma lógica:
  if (status !== 'success') {
    const arquivoErros = path.join(__dirname, '../results', `${job_id}_erros.jsonl`)
    await fs.appendFile(arquivoErros, linha)
  }
}


    async limparJobsAntigos(diasParaManter = 7) {
        try {
            const dataLimite = new Date();
            dataLimite.setDate(dataLimite.getDate() - diasParaManter);

            // Limpar jobs da fila
            await this.mlbQueue.clean(diasParaManter * 24 * 60 * 60 * 1000, 'completed');
            await this.mlbQueue.clean(diasParaManter * 24 * 60 * 60 * 1000, 'failed');

            console.log(`🧹 Jobs mais antigos que ${diasParaManter} dias foram removidos`);
        } catch (error) {
            console.error('Erro ao limpar jobs antigos:', error);
        }
    }

    // Método para pausar/retomar processamento
    async pausarJob() {
        await this.mlbQueue.pause();
        console.log('⏸️ Processamento pausado');
    }

    async retomarJob() {
        await this.mlbQueue.resume();
        console.log('▶️ Processamento retomado');
    }

    // Estatísticas gerais
    async obterEstatisticas() {
        const waiting = await this.mlbQueue.getWaiting();
        const active = await this.mlbQueue.getActive();
        const completed = await this.mlbQueue.getCompleted();
        const failed = await this.mlbQueue.getFailed();

        return {
            fila_aguardando: waiting.length,
            processando_agora: active.length,
            concluidos_recentes: completed.length,
            falharam_recentes: failed.length,
            total_na_fila: waiting.length + active.length
        };
    }

    // Listar todos os jobs ativos
    async listarJobsAtivos() {
        try {
            const resultsDir = path.join(__dirname, '../results');
            const files = await fs.readdir(resultsDir);
            
            const metadataFiles = files.filter(file => file.endsWith('_metadata.json'));
            const jobs = [];

            for (const file of metadataFiles) {
                try {
                    const filePath = path.join(resultsDir, file);
                    const metadata = JSON.parse(await fs.readFile(filePath, 'utf8'));
                    
                    // Obter status atual do job
                    const status = await this.obterStatusJob(metadata.job_id);
                    jobs.push(status);
                } catch (error) {
                    console.error(`Erro ao ler metadata ${file}:`, error);
                }
            }

            // Ordenar por data de criação (mais recentes primeiro)
            return jobs.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));

        } catch (error) {
            console.error('Erro ao listar jobs:', error);
            return [];
        }
    }

    // Cancelar job específico
    async cancelarJob(job_id) {
        try {
            const waiting = await this.mlbQueue.getWaiting();
            const active = await this.mlbQueue.getActive();
            
            const jobsParaCancelar = [...waiting, ...active].filter(job => job.data.job_id === job_id);
            
            for (const job of jobsParaCancelar) {
                await job.remove();
            }

            // Atualizar metadata
            await this.atualizarMetadataJob(job_id, {
                status: 'cancelado',
                cancelado_em: new Date().toISOString()
            });

            console.log(`🚫 Job ${job_id} cancelado. ${jobsParaCancelar.length} jobs removidos da fila.`);
            
            return {
                sucesso: true,
                jobs_cancelados: jobsParaCancelar.length,
                message: `Job ${job_id} cancelado com sucesso`
            };

        } catch (error) {
            console.error(`Erro ao cancelar job ${job_id}:`, error);
            throw error;
        }
    }

   async obterResultadosParciais(job_id, limite = 100) {
  try {
    const arquivo = path.join(__dirname, '../results', `${job_id}_resultados.jsonl`);
    const conteudo = await fs.readFile(arquivo, 'utf8');
    const linhas = conteudo.trim().split('\n');

    // Parse e mapeia somente os campos úteis
    const resultados = linhas
      .slice(-limite)                    // últimos N registros
      .map(linha => JSON.parse(linha))
      .map(r => ({
        mlb: r.mlb,
        encontrado: r.encontrado
        }));


    return {
      total_resultados: linhas.length,
      resultados_retornados: resultados.length,
      resultados
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { total_resultados: 0, resultados_retornados: 0, resultados: [] };
    }
    throw error;
  }
}


    // Obter estatísticas de um job específico
    async obterEstatisticasJob(job_id) {
        const { resultados, total_resultados } = await this.obterResultadosParciais(job_id, 999999);
        const encontrados = resultados.filter(r => r.encontrado).length;
        // opcionalmente trate “sucessos” igual a total_resultados se quiser
        const sucessos = total_resultados;  

        return {
            job_id,
            total_processados: total_resultados,
            sucessos,
            erros: 0,               // não faz mais sentido
            encontrados,
            taxa_sucesso: 100,      // todos são “sucesso” no sense antigo
            taxa_deteccao: total_resultados
            ? Math.round((encontrados / total_resultados) * 100)
            : 0
        };
        }


    // Reprocessar MLBs que falharam
    async reprocessarErros(job_id) {
        try {
            const arquivoErros = path.join(__dirname, '../results', `${job_id}_erros.jsonl`);
            const conteudo = await fs.readFile(arquivoErros, 'utf8');
            
            const linhas = conteudo.trim().split('\n');
            const erros = linhas.map(linha => JSON.parse(linha));
            const mlbsParaReprocessar = erros.map(erro => erro.mlb);

            if (mlbsParaReprocessar.length === 0) {
                return {
                    sucesso: false,
                    message: 'Nenhum erro encontrado para reprocessar'
                };
            }

            // Obter metadata original para usar as mesmas opções
            const metadata = JSON.parse(await fs.readFile(
                path.join(__dirname, '../results', `${job_id}_metadata.json`), 
                'utf8'
            ));

            // Criar novo job para reprocessamento
            const novoJob = await this.adicionarLoteMLBs(mlbsParaReprocessar, metadata.opcoes);

            return {
                sucesso: true,
                job_original: job_id,
                novo_job_id: novoJob.job_id,
                mlbs_reprocessar: mlbsParaReprocessar.length,
                message: `Reprocessamento iniciado. Novo job: ${novoJob.job_id}`
            };

        } catch (error) {
            throw new Error(`Erro ao reprocessar erros do job ${job_id}: ${error.message}`);
        }
    }

    // ========== MÉTODOS DE COMPATIBILIDADE PARA O NOVO ROUTER ==========

// Adaptar para o novo router
async enqueuePesquisaDescricao(data) {
    const { consultas, opcoes } = data;
    
    // Validação mais flexível para MLBs
    const mlbs = consultas.filter(c => {
        if (typeof c !== 'string') return false;
        return c.match(/^MLB\d{10,12}$/i); // 10-12 dígitos, case insensitive
    });
    
    if (mlbs.length === 0) {
        throw new Error(`Nenhum MLB válido encontrado nas consultas. Recebido: ${JSON.stringify(consultas)}`);
    }
    
    console.log(`📋 MLBs válidos encontrados: ${mlbs.join(', ')}`);
    
    const job = await this.adicionarLoteMLBs(mlbs, opcoes);
    return { id: job.job_id, jobId: job.job_id };
}

async getJob(jobId) {
    try {
        const status = await this.obterStatusJob(jobId);
        return {
            id: jobId,
            status: status.status,
            result: status.arquivos_disponiveis,
            progress: status.progresso_percentual
        };
    } catch (error) {
        return null;
    }
}

async listJobs(options = {}) {
    const jobs = await this.listarJobsAtivos();
    
    if (options.status) {
        return jobs.filter(job => job.status === options.status);
    }
    
    return jobs;
}

async cancelJob(jobId) {
    return await this.cancelarJob(jobId);
}

async reprocessar(jobId) {
    return await this.reprocessarErros(jobId);
}

async pause() {
    return await this.pausarJob();
}

async resume() {
    return await this.retomarJob();
}

async stats() {
    return await this.obterEstatisticas();
}

// Método para obter diretório de resultados
async getResultDir(jobId) {
    return path.join(__dirname, '../results');
}
}

module.exports = new QueueService();