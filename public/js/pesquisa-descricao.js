// Variáveis globais
let modoProcessamentoSelecionado = null;
let intervalMonitoramento = null;
let jobAtualMonitorando = null;

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    // Verificar se deve abrir modal de novo processo (vindo do dashboard)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('novo_processo') === 'true') {
        abrirTab('processamento-massa');
        setTimeout(() => {
            abrirModalNovoProcesso();
        }, 500);
    }

    // Inicializar contadores
    contarMLBsRapida();
    contarMLBsMassa();
    
    // Carregar monitoramento se estiver na aba
    if (document.getElementById('monitoramento').classList.contains('active')) {
        atualizarMonitoramento();
    }
});

// Gerenciamento de Tabs
function abrirTab(tabId) {
    // Remover classe active de todas as tabs
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Ativar tab selecionada
    event.target.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    
    // Ações específicas por tab
    if (tabId === 'monitoramento') {
        atualizarMonitoramento();
        iniciarMonitoramentoAutomatico();
    } else {
        pararMonitoramentoAutomatico();
    }
}

// Pesquisa Rápida
function alterarTipoPesquisaRapida() {
    const tipo = document.getElementById('tipo-pesquisa-rapida').value;
    const grupoTexto = document.getElementById('grupo-texto-rapida');
    
    if (tipo === 'pesquisar_texto') {
        grupoTexto.style.display = 'block';
        document.getElementById('texto-pesquisa-rapida').required = true;
    } else {
        grupoTexto.style.display = 'none';
        document.getElementById('texto-pesquisa-rapida').required = false;
    }
}

function contarMLBsRapida() {
    const texto = document.getElementById('mlbs-rapida').value;
    const resultado = contarMLBs(texto);
    
    document.getElementById('total-mlbs-rapida').textContent = resultado.total;
    document.getElementById('validos-mlbs-rapida').textContent = resultado.validos;
    document.getElementById('invalidos-mlbs-rapida').textContent = resultado.invalidos;
    
    const statusLimite = document.getElementById('status-limite-rapida');
    if (resultado.total > 50) {
        statusLimite.textContent = 'Excede limite! Use Processamento em Massa';
        statusLimite.style.background = '#dc3545';
        statusLimite.style.color = 'white';
    } else {
        statusLimite.textContent = 'Limite: 50 MLBs';
        statusLimite.style.background = '#e9ecef';
        statusLimite.style.color = '#495057';
    }
}

function limparFormularioRapida() {
    document.getElementById('form-pesquisa-rapida').reset();
    document.getElementById('grupo-texto-rapida').style.display = 'none';
    contarMLBsRapida();
    fecharResultados();
}

// Processamento em Massa
function selecionarModo(modo) {
    // Remover seleção anterior
    document.querySelectorAll('.processing-mode').forEach(el => {
        el.classList.remove('selected');
    });
    
    // Selecionar novo modo
    document.getElementById(`modo-${modo}`).classList.add('selected');
    modoProcessamentoSelecionado = modo;
    
    atualizarModoProcessamento();
}

function atualizarModoProcessamento() {
    const total = parseInt(document.getElementById('total-mlbs-massa').textContent) || 0;
    const forcaBackground = document.getElementById('forcar-background-massa').checked;
    const statusElement = document.getElementById('status-processamento-massa');
    
    let modo, cor;
    
    if (forcaBackground || total > 100) {
        modo = 'Background';
        cor = '#667eea';
        selecionarModo('background');
    } else if (modoProcessamentoSelecionado === 'direto' || (total <= 100 && total > 0)) {
        modo = 'Direto';
        cor = '#28a745';
        if (!modoProcessamentoSelecionado) selecionarModo('direto');
    } else {
        modo = 'Não Selecionado';
        cor = '#6c757d';
    }
    
    statusElement.textContent = `Modo: ${modo}`;
    statusElement.style.background = cor;
    statusElement.style.color = 'white';
}

function alterarTipoPesquisaMassa() {
    const tipo = document.getElementById('tipo-pesquisa-massa').value;
    const grupoTexto = document.getElementById('grupo-texto-massa');
    
    if (tipo === 'pesquisar_texto') {
        grupoTexto.style.display = 'block';
        document.getElementById('texto-pesquisa-massa').required = true;
    } else {
        grupoTexto.style.display = 'none';
        document.getElementById('texto-pesquisa-massa').required = false;
    }
}

function contarMLBsMassa() {
    const texto = document.getElementById('mlbs-massa').value;
    const resultado = contarMLBs(texto);
    
    document.getElementById('total-mlbs-massa').textContent = resultado.total;
    document.getElementById('validos-mlbs-massa').textContent = resultado.validos;
    document.getElementById('invalidos-mlbs-massa').textContent = resultado.invalidos;
    
    // Calcular tempo estimado (aproximadamente 2 segundos por MLB)
    const tempoMinutos = Math.ceil((resultado.validos * 2) / 60);
    document.getElementById('tempo-estimado-massa').textContent = tempoMinutos;
    
    atualizarModoProcessamento();
}

function limparFormularioMassa() {
    document.getElementById('form-processamento-massa').reset();
    document.getElementById('grupo-texto-massa').style.display = 'none';
    document.querySelectorAll('.processing-mode').forEach(el => {
        el.classList.remove('selected');
    });
    modoProcessamentoSelecionado = null;
    contarMLBsMassa();
    fecharResultados();
}

async function validarMLBsMassa() {
    const texto = document.getElementById('mlbs-massa').value;
    if (!texto.trim()) {
        alert('❌ Digite alguns MLBs para validar');
        return;
    }

    const mlbs = extrairMLBs(texto);
    if (mlbs.length === 0) {
        alert('❌ Nenhum MLB válido encontrado');
        return;
    }

    try {
        const resultado = contarMLBs(texto);
        alert(`✅ Validação concluída:

📊 Total encontrados: ${resultado.total}
✅ MLBs válidos: ${resultado.validos}
❌ MLBs inválidos: ${resultado.invalidos}
⏱️ Tempo estimado: ${Math.ceil((resultado.validos * 2) / 60)} minutos`);
    } catch (error) {
        alert('❌ Erro na validação: ' + error.message);
    }
}

// Funções de Formulário
document.getElementById('form-pesquisa-rapida').addEventListener('submit', async function(e) {
    e.preventDefault();
    await executarPesquisaRapida();
});

document.getElementById('form-processamento-massa').addEventListener('submit', async function(e) {
    e.preventDefault();
    await executarProcessamentoMassa();
});

async function executarPesquisaRapida() {
    const tipo = document.getElementById('tipo-pesquisa-rapida').value;
    const texto = document.getElementById('texto-pesquisa-rapida').value;
    const mlbsTexto = document.getElementById('mlbs-rapida').value;

    if (!tipo || !mlbsTexto.trim()) {
        alert('❌ Preencha todos os campos obrigatórios');
        return;
    }

    const mlbs = extrairMLBs(mlbsTexto);
    if (mlbs.length === 0) {
        alert('❌ Nenhum MLB válido encontrado');
        return;
    }

    if (mlbs.length > 50) {
        alert('❌ Muitos MLBs para pesquisa rápida. Use o Processamento em Massa.');
        return;
    }

    const btnPesquisar = document.getElementById('btn-pesquisar-rapida');
    const textoOriginal = btnPesquisar.innerHTML;
    
    try {
        btnPesquisar.innerHTML = '<div class="spinner"></div> Pesquisando...';
        btnPesquisar.disabled = true;

        const payload = {
            consultas: mlbs,
            opcoes: {
                tipo_processamento: tipo,
                texto: tipo === 'pesquisar_texto' ? texto : undefined
            }
        };

        const response = await fetch('/api/pesquisa-descricao/enfileirar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.ok) {
            alert(`✅ Pesquisa iniciada com sucesso!
            
Job ID: ${data.job_id || data.id}
Total MLBs: ${mlbs.length}

Acompanhe o progresso na aba Monitoramento.`);
            
            abrirTab('monitoramento');
        } else {
            alert('❌ Erro: ' + (data.message || data.error));
        }

    } catch (error) {
        alert('❌ Erro na pesquisa: ' + error.message);
    } finally {
        btnPesquisar.innerHTML = textoOriginal;
        btnPesquisar.disabled = false;
    }
}

async function executarProcessamentoMassa() {
    const tipo = document.getElementById('tipo-pesquisa-massa').value;
    const texto = document.getElementById('texto-pesquisa-massa').value;
    const mlbsTexto = document.getElementById('mlbs-massa').value;
    const forcaBackground = document.getElementById('forcar-background-massa').checked;

    if (!tipo || !mlbsTexto.trim()) {
        alert('❌ Preencha todos os campos obrigatórios');
        return;
    }

    if (!modoProcessamentoSelecionado) {
        alert('❌ Selecione um modo de processamento');
        return;
    }

    const mlbs = extrairMLBs(mlbsTexto);
    if (mlbs.length === 0) {
        alert('❌ Nenhum MLB válido encontrado');
        return;
    }

    const btnProcessar = document.getElementById('btn-processar-massa');
    const textoOriginal = btnProcessar.innerHTML;
    
    try {
        btnProcessar.innerHTML = '<div class="spinner"></div> Iniciando...';
        btnProcessar.disabled = true;

        const payload = {
            consultas: mlbs,
            opcoes: {
                tipo_processamento: tipo,
                texto: tipo === 'pesquisar_texto' ? texto : undefined,
                forca_background: forcaBackground
            }
        };

        const response = await fetch('/api/pesquisa-descricao/enfileirar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.ok) {
            alert(`🚀 Processamento iniciado com sucesso!

Job ID: ${data.job_id || data.id}
Total MLBs: ${mlbs.length}

O processamento será executado em background. Acompanhe o progresso na aba Monitoramento.`);
            
            abrirTab('monitoramento');
        } else {
            alert('❌ Erro: ' + (data.message || data.error));
        }

    } catch (error) {
        alert('❌ Erro no processamento: ' + error.message);
    } finally {
        btnProcessar.innerHTML = textoOriginal;
        btnProcessar.disabled = false;
    }
}

// Monitoramento
function iniciarMonitoramentoAutomatico() {
    if (intervalMonitoramento) {
        clearInterval(intervalMonitoramento);
    }
    intervalMonitoramento = setInterval(atualizarMonitoramento, 5000);
}

function pararMonitoramentoAutomatico() {
    if (intervalMonitoramento) {
        clearInterval(intervalMonitoramento);
        intervalMonitoramento = null;
    }
}

async function atualizarMonitoramento() {
    try {
        const response = await fetch('/api/pesquisa-descricao/status');
        const data = await response.json();

        if (data.ok) {
            atualizarEstatisticasMonitor(data.stats);
        }

        // Buscar lista de jobs
        const jobsResponse = await fetch('/api/pesquisa-descricao/jobs');
        const jobsData = await jobsResponse.json();

        if (jobsData.ok) {
            exibirProcessosMonitor(jobsData.jobs || []);
        }
    } catch (error) {
        console.error('Erro ao atualizar monitoramento:', error);
    }
}

function atualizarEstatisticasMonitor(stats) {
    document.getElementById('stat-processando').textContent = stats.processando_agora || 0;
    document.getElementById('stat-aguardando').textContent = stats.fila_aguardando || 0;
    document.getElementById('stat-concluidos').textContent = stats.concluidos_recentes || 0;
    document.getElementById('stat-erros').textContent = stats.falharam_recentes || 0;
}

function exibirProcessosMonitor(jobs) {
    const container = document.getElementById('lista-processos-monitor');
    
    if (!jobs || jobs.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <p>📭 Nenhum processo encontrado</p>
                <button class="btn btn-primary" onclick="abrirModalNovoProcesso()">
                    ➕ Iniciar Primeiro Processo
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = jobs.map((job, index) => {
        // Verificações defensivas para evitar erros
        if (!job) return '';
        
        // Dados seguros com fallbacks
        const jobId = job.id || job.job_id || `job_${index}`;
        const status = job.status || 'aguardando';
        const progress = job.progress || 0;
        
        // Gerar nome amigável baseado no tipo e data
        const agora = new Date();
        const dataProcessamento = agora.toLocaleDateString('pt-BR');
        const horaProcessamento = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        let nomeAmigavel = '';
        let tipoIcon = '🔍';
        
        // Determinar tipo de processamento
        const tipoProcessamento = job.tipo_processamento || job.tipo || 'detectar_dois_volumes';
        
        if (tipoProcessamento === 'detectar_dois_volumes') {
            nomeAmigavel = `Detecção de Dois Volumes - ${dataProcessamento} ${horaProcessamento}`;
            tipoIcon = '📦';
        } else if (tipoProcessamento === 'pesquisar_texto') {
            nomeAmigavel = `Pesquisa de Texto - ${dataProcessamento} ${horaProcessamento}`;
            tipoIcon = '📝';
        } else {
            nomeAmigavel = `Processamento #${index + 1} - ${dataProcessamento} ${horaProcessamento}`;
            tipoIcon = '🔍';
        }

        // Calcular progresso real com verificações
        let progressoReal = 0;
        if (status === 'concluido') {
            progressoReal = 100;
        } else if (typeof progress === 'number') {
            progressoReal = Math.min(100, Math.max(0, progress));
        }
        
        // Determinar status em português
        const statusMap = {
            'processando': { texto: 'Processando', cor: '#ffc107', icon: '⚡' },
            'aguardando': { texto: 'Na Fila', cor: '#6c757d', icon: '⏳' },
            'concluido': { texto: 'Concluído', cor: '#28a745', icon: '✅' },
            'cancelado': { texto: 'Cancelado', cor: '#dc3545', icon: '❌' },
            'erro': { texto: 'Com Erro', cor: '#dc3545', icon: '⚠️' }
        };
        
        const statusInfo = statusMap[status] || statusMap['aguardando'];
        
        // Informações de resultados com verificações defensivas
        const totalMLBs = job.total_mlbs || 
                         (job.consultas && job.consultas.length) || 
                         0;
        
        const concluidos = job.concluidos || 0;
        const falharam = job.falharam || 0;
        const processados = concluidos + falharam;
        const encontrados = job.encontrados || concluidos || 0;
        
        const tempoDecorrido = job.tempo_decorrido || 
                              job.created_at ? 'Há alguns minutos' : 
                              'Iniciado agora';
        
        return `
            <div class="job-tracking">
                <div class="job-header">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                            <span style="font-size: 20px;">${tipoIcon}</span>
                            <strong style="font-size: 16px;">${nomeAmigavel}</strong>
                        </div>
                        <div style="font-family: 'Courier New', monospace; font-size: 12px; color: #666; margin-left: 30px;">
                            ID: ${jobId}
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span style="background: ${statusInfo.cor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                            ${statusInfo.icon} ${statusInfo.texto}
                        </span>
                        <div style="font-size: 12px; color: #666; margin-top: 5px;">
                            ${tempoDecorrido}
                        </div>
                    </div>
                </div>
                
                <div style="margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; font-size: 14px;">
                        <div style="text-align: center;">
                            <div style="font-weight: 600; color: #333;">${totalMLBs}</div>
                            <div style="color: #666; font-size: 12px;">Total MLBs</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-weight: 600; color: #333;">${processados}</div>
                            <div style="color: #666; font-size: 12px;">Processados</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-weight: 600; color: #28a745;">${encontrados}</div>
                            <div style="color: #666; font-size: 12px;">Encontrados</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-weight: 600; color: #667eea;">${progressoReal}%</div>
                            <div style="color: #666; font-size: 12px;">Progresso</div>
                        </div>
                    </div>
                </div>
                
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressoReal}%">
                            <div class="progress-text">${progressoReal}% concluído</div>
                        </div>
                    </div>
                </div>
                
                <div class="job-actions">
                    <button class="btn btn-primary" onclick="verDetalhesJob('${jobId}')">
                        📊 Detalhes
                    </button>
                    ${status === 'concluido' || job.result ? `
                        <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-success">
                            📥 Download Resultados
                        </a>
                    ` : ''}
                    ${status === 'processando' || status === 'aguardando' ? `
                        <button class="btn btn-danger" onclick="cancelarJob('${jobId}')">
                            🚫 Cancelar
                        </button>
                    ` : ''}
                    ${status === 'concluido' && encontrados > 0 ? `
                        <button class="btn btn-warning" onclick="verResultados('${jobId}')">
                            ��️ Ver Resultados
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).filter(html => html !== '').join('');
}

// Adicione no início da função atualizarMonitoramento
async function atualizarMonitoramento() {
    try {
        console.log('🔍 Atualizando monitoramento...');
        
        const response = await fetch('/api/pesquisa-descricao/status');
        const data = await response.json();
        console.log('📊 Status data:', data);

        if (data.ok) {
            atualizarEstatisticasMonitor(data.stats);
        }

        // Buscar lista de jobs
        const jobsResponse = await fetch('/api/pesquisa-descricao/jobs');
        const jobsData = await jobsResponse.json();
        console.log('📋 Jobs data:', jobsData);

        if (jobsData.ok) {
            console.log('📋 Jobs encontrados:', jobsData.jobs);
            exibirProcessosMonitor(jobsData.jobs || []);
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar monitoramento:', error);
        // Exibir erro na interface
        document.getElementById('lista-processos-monitor').innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ Erro ao carregar processos:</strong><br>
                ${error.message}
            </div>
        `;
    }
}
async function verResultados(jobId) {
    try {
        const response = await fetch(`/api/pesquisa-descricao/jobs/${jobId}`);
        const data = await response.json();

        if (data.ok || data.job) {
            const job = data.job || data;
            
            // Simular resultados baseados nos dados do job
            const resultadosHtml = `
                <div style="max-height: 400px; overflow-y: auto;">
                    <div class="alert alert-success">
                        <strong>✅ Processamento Concluído!</strong><br>
                        ${job.encontrados || 0} produtos encontrados de ${job.total_mlbs || 0} processados
                    </div>
                    
                    <div style="text-align: center; padding: 20px;">
                        <p>📋 Para ver os resultados detalhados, faça o download do arquivo.</p>
                        <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-success">
                            �� Download Resultados Completos
                        </a>
                    </div>
                </div>
            `;
            
            document.getElementById('results-content').innerHTML = resultadosHtml;
            document.getElementById('results-stats').innerHTML = `
                <div class="stat-card">
                    <div class="stat-number">${job.total_mlbs || 0}</div>
                    <div class="stat-label">Total Processados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${job.encontrados || 0}</div>
                    <div class="stat-label">Encontrados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${job.tempo_decorrido || 'N/A'}</div>
                    <div class="stat-label">Tempo Total</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${job.total_mlbs ? Math.round((job.encontrados / job.total_mlbs) * 100) : 0}%</div>
                    <div class="stat-label">Taxa de Sucesso</div>
                </div>
            `;
            
            document.getElementById('results-container').style.display = 'block';
            document.getElementById('results-container').scrollIntoView({ behavior: 'smooth' });
        }
    } catch (error) {
        alert('❌ Erro ao obter resultados: ' + error.message);
    }
}
// Modais
function abrirModalNovoProcesso() {
    document.getElementById('modal-novo-processo').style.display = 'block';
}

function fecharModalNovoProcesso() {
    document.getElementById('modal-novo-processo').style.display = 'none';
    document.getElementById('form-modal-processo').reset();
    document.getElementById('grupo-texto-modal').style.display = 'none';
}

async function iniciarProcessoModal() {
    const tipo = document.getElementById('tipo-modal').value;
    const texto = document.getElementById('texto-modal').value;
    const mlbsTexto = document.getElementById('mlbs-modal').value;

    if (!tipo || !mlbsTexto.trim()) {
        alert('❌ Preencha todos os campos obrigatórios');
        return;
    }

    const mlbs = extrairMLBs(mlbsTexto);
    if (mlbs.length === 0) {
        alert('❌ Nenhum MLB válido encontrado');
        return;
    }

    try {
        const payload = {
            consultas: mlbs,
            opcoes: {
                tipo_processamento: tipo,
                texto: tipo === 'pesquisar_texto' ? texto : undefined
            }
        };

        const response = await fetch('/api/pesquisa-descricao/enfileirar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.ok) {
            alert(`✅ Processo iniciado com sucesso!
            
Job ID: ${data.job_id || data.id}
Total MLBs: ${mlbs.length}`);
            
            fecharModalNovoProcesso();
            atualizarMonitoramento();
        } else {
            alert('❌ Erro: ' + (data.message || data.error));
        }
    } catch (error) {
        alert('❌ Erro: ' + error.message);
    }
}

async function verDetalhesJob(jobId) {
    try {
        // Mostrar loading na modal
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <span>Carregando detalhes...</span>
            </div>
        `;
        
        // Abrir modal imediatamente
        document.getElementById('modal-detalhes-job').style.display = 'block';
        
        console.log('🔍 Buscando detalhes do job:', jobId);
        
        const response = await fetch(`/api/pesquisa-descricao/jobs/${jobId}`);
        const data = await response.json();
        
        console.log('📊 Dados da API:', data);

        if (data.ok && data.result && Array.isArray(data.result)) {
            // Buscar o arquivo de metadados
            const metadataFile = data.result.find(file => file.tipo === 'metadata');
            
            if (metadataFile) {
                console.log('📋 Buscando metadados de:', metadataFile.url);
                
                try {
                    const metadataResponse = await fetch(metadataFile.url);
                    const metadata = await metadataResponse.json();
                    
                    console.log('📊 Metadados carregados:', metadata);
                    
                    // Processar com os metadados reais
                    processarDetalhesComMetadados(jobId, data, metadata);
                    
                } catch (metadataError) {
                    console.error('❌ Erro ao carregar metadados:', metadataError);
                    // Fallback: processar sem metadados
                    processarDetalhesSemMetadados(jobId, data);
                }
            } else {
                console.log('⚠️ Arquivo de metadados não encontrado');
                processarDetalhesSemMetadados(jobId, data);
            }
        } else {
            throw new Error('Dados inválidos recebidos da API');
        }

    } catch (error) {
        console.error('❌ Erro ao obter detalhes:', error);
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ Erro de Conexão</strong><br>
                ${error.message}
                <br><br>
                <button class="btn btn-primary" onclick="verDetalhesJob('${jobId}')">
                    🔄 Tentar Novamente
                </button>
            </div>
        `;
    }
}
async function verDetalhesJob(jobId) {
    try {
        // Mostrar loading na modal
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <span>Carregando detalhes...</span>
            </div>
        `;
        
        // Abrir modal imediatamente
        document.getElementById('modal-detalhes-job').style.display = 'block';
        
        console.log('🔍 Buscando detalhes do job:', jobId);
        
        const response = await fetch(`/api/pesquisa-descricao/jobs/${jobId}`);
        const data = await response.json();
        
        console.log('📊 Dados da API:', data);

        if (data.ok && data.result && Array.isArray(data.result)) {
            // Buscar o arquivo de metadados
            const metadataFile = data.result.find(file => file.tipo === 'metadata');
            
            if (metadataFile) {
                console.log('📋 Tentando carregar metadados de:', metadataFile.url);
                
                // Mostrar progresso
                document.getElementById('detalhes-job-content').innerHTML = `
                    <div class="loading">
                        <div class="spinner"></div>
                        <span>Carregando metadados...</span>
                    </div>
                `;
                
                try {
                    const metadataResponse = await fetch(metadataFile.url);
                    console.log('📡 Response status:', metadataResponse.status);
                    
                    if (!metadataResponse.ok) {
                        throw new Error(`HTTP ${metadataResponse.status}: ${metadataResponse.statusText}`);
                    }
                    
                    const metadataText = await metadataResponse.text();
                    console.log('📄 Metadata raw text:', metadataText);
                    
                    const metadata = JSON.parse(metadataText);
                    console.log('📊 Metadados parseados:', metadata);
                    
                    // Processar com os metadados reais
                    processarDetalhesComMetadados(jobId, data, metadata);
                    
                } catch (metadataError) {
                    console.error('❌ Erro ao carregar metadados:', metadataError);
                    
                    // Mostrar erro específico e opção de debug
                    document.getElementById('detalhes-job-content').innerHTML = `
                        <div class="alert alert-warning">
                            <strong>⚠️ Erro ao carregar metadados:</strong><br>
                            ${metadataError.message}
                            <br><br>
                            <button class="btn btn-primary" onclick="debugMetadados('${metadataFile.url}')">
                                🐛 Debug Metadados
                            </button>
                            <button class="btn btn-secondary" onclick="processarDetalhesSemMetadados('${jobId}', ${JSON.stringify(data).replace(/"/g, '&quot;')})">
                                📋 Continuar sem Metadados
                            </button>
                        </div>
                    `;
                }
            } else {
                console.log('⚠️ Arquivo de metadados não encontrado');
                processarDetalhesSemMetadados(jobId, data);
            }
        } else {
            throw new Error('Dados inválidos recebidos da API');
        }

    } catch (error) {
        console.error('❌ Erro ao obter detalhes:', error);
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ Erro de Conexão</strong><br>
                ${error.message}
                <br><br>
                <button class="btn btn-primary" onclick="verDetalhesJob('${jobId}')">
                    🔄 Tentar Novamente
                </button>
            </div>
        `;
    }
}

// Função para debug específico dos metadados
async function debugMetadados(url) {
    try {
        console.log('🐛 Debugando URL:', url);
        
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <span>Debugando metadados...</span>
            </div>
        `;
        
        const response = await fetch(url);
        console.log('📡 Response completa:', response);
        console.log('📡 Headers:', [...response.headers.entries()]);
        
        const text = await response.text();
        console.log('📄 Conteúdo bruto:', text);
        
        document.getElementById('detalhes-job-content').innerHTML = `
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                <h5>🐛 Debug dos Metadados</h5>
                
                <div style="margin: 15px 0;">
                    <strong>URL:</strong><br>
                    <code>${url}</code>
                </div>
                
                <div style="margin: 15px 0;">
                    <strong>Status HTTP:</strong> ${response.status}<br>
                    <strong>Content-Type:</strong> ${response.headers.get('content-type')}
                </div>
                
                <div style="margin: 15px 0;">
                    <strong>Conteúdo Raw:</strong><br>
                    <pre style="background: #e9ecef; padding: 10px; border-radius: 4px; font-size: 12px; max-height: 300px; overflow-y: auto;">${text}</pre>
                </div>
                
                <div style="text-align: center; margin-top: 20px;">
                    <button class="btn btn-warning" onclick="tentarParsearMetadados('${text.replace(/'/g, "\'")}')" >
                        🔧 Tentar Parsear
                    </button>
                    <button class="btn btn-secondary" onclick="verDetalhesJob('${new URLSearchParams(url).get('jobId') || 'unknown'}')">
                        🔄 Voltar
                    </button>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('❌ Erro no debug:', error);
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ Erro no Debug:</strong><br>
                ${error.message}
            </div>
        `;
    }
}

// Função para tentar parsear metadados manualmente
function tentarParsearMetadados(textoRaw) {
    try {
        console.log('🔧 Tentando parsear:', textoRaw);
        
        let metadata;
        
        // Tentar JSON direto
        try {
            metadata = JSON.parse(textoRaw);
            console.log('✅ JSON válido:', metadata);
        } catch (jsonError) {
            console.log('❌ Não é JSON válido, tentando outras abordagens...');
            
            // Tentar JSONL (uma linha por objeto)
            const linhas = textoRaw.split('\n').filter(linha => linha.trim());
            if (linhas.length > 0) {
                try {
                    metadata = JSON.parse(linhas[0]); // Primeira linha
                    console.log('✅ JSONL parseado:', metadata);
                } catch (jsonlError) {
                    throw new Error('Formato não reconhecido');
                }
            }
        }
        
        if (metadata) {
            document.getElementById('detalhes-job-content').innerHTML = `
                <div style="background: #d4edda; border: 1px solid #28a745; border-radius: 8px; padding: 15px;">
                    <strong>✅ Metadados parseados com sucesso!</strong><br>
                    <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px; margin-top: 10px;">${JSON.stringify(metadata, null, 2)}</pre>
                    
                    <div style="text-align: center; margin-top: 15px;">
                        <button class="btn btn-success" onclick="usarMetadados('${JSON.stringify(metadata).replace(/"/g, '&quot;')}')" >
                            ✅ Usar estes Metadados
                        </button>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('❌ Erro ao parsear:', error);
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ Erro ao Parsear:</strong><br>
                ${error.message}
                <br><br>
                <small>O arquivo pode estar corrompido ou em formato não suportado.</small>
            </div>
        `;
    }
}

// Função para usar metadados parseados manualmente
function usarMetadados(metadataString) {
    try {
        const metadata = JSON.parse(metadataString.replace(/&quot;/g, '"'));
        console.log('🎯 Usando metadados:', metadata);
        
        // Aqui você pode chamar a função de processamento
        // processarDetalhesComMetadados(jobId, dadosAPI, metadata);
        
        document.getElementById('detalhes-job-content').innerHTML = `
            <div class="alert alert-success">
                <strong>✅ Metadados carregados!</strong><br>
                Agora você pode implementar o processamento com estes dados.
            </div>
        `;
        
    } catch (error) {
        console.error('❌ Erro ao usar metadados:', error);
    }
}
function processarDetalhesComMetadados(jobId, dadosAPI, metadata) {
    console.log('🎯 Processando com metadados:', metadata);
    
    // Extrair dados dos metadados
    const status = dadosAPI.status || 'concluido';
    const totalMLBs = metadata.total_mlbs || metadata.total_consultas || 0;
    const processados = metadata.total_processados || totalMLBs;
    const encontrados = metadata.total_encontrados || metadata.produtos_encontrados || 0;
    const falharam = metadata.total_falharam || metadata.erros || 0;
    const tempoDecorrido = metadata.tempo_total || metadata.duracao || 'Não disponível';
    const inicioProcessamento = metadata.inicio_processamento || metadata.created_at;
    const fimProcessamento = metadata.fim_processamento || metadata.completed_at;
    
    // Calcular progresso
    const progressoReal = status === 'concluido' ? 100 : 0;
    
    // Determinar status em português
    const statusMap = {
        'processando': { texto: 'Processando', cor: '#ffc107', icon: '⚡' },
        'aguardando': { texto: 'Na Fila', cor: '#6c757d', icon: '⏳' },
        'concluido': { texto: 'Concluído', cor: '#28a745', icon: '✅' },
        'cancelado': { texto: 'Cancelado', cor: '#dc3545', icon: '❌' },
        'erro': { texto: 'Com Erro', cor: '#dc3545', icon: '⚠️' }
    };
    
    const statusInfo = statusMap[status] || statusMap['concluido'];
    
    // Gerar nome amigável baseado no tipo
    const tipoProcessamento = metadata.tipo_processamento || 'detectar_dois_volumes';
    let nomeAmigavel = '';
    let tipoIcon = '🔍';
    
    if (tipoProcessamento === 'detectar_dois_volumes') {
        nomeAmigavel = 'Detecção de Dois Volumes';
        tipoIcon = '📦';
    } else if (tipoProcessamento === 'pesquisar_texto') {
        nomeAmigavel = `Pesquisa de Texto: "${metadata.texto_pesquisado || 'N/A'}"`;
        tipoIcon = '📝';
    } else {
        nomeAmigavel = 'Processamento de MLBs';
        tipoIcon = '🔍';
    }
    
    // Formatear datas
    const dataInicio = inicioProcessamento ? new Date(inicioProcessamento).toLocaleString('pt-BR') : 'N/A';
    const dataFim = fimProcessamento ? new Date(fimProcessamento).toLocaleString('pt-BR') : 'N/A';
    
    const detalhesHtml = `
        <div class="job-tracking">
            <!-- Cabeçalho do Job -->
            <div style="text-align: center; margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
                <div style="font-size: 24px; margin-bottom: 5px;">${tipoIcon}</div>
                <h4 style="margin: 0; font-size: 18px;">${nomeAmigavel}</h4>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">
                    Processado em ${dataInicio}
                </div>
            </div>
            
            <!-- Status Atual -->
            <div style="display: flex; justify-content: center; margin-bottom: 20px;">
                <span style="background: ${statusInfo.cor}; color: white; padding: 8px 16px; border-radius: 20px; font-weight: 600;">
                    ${statusInfo.icon} ${statusInfo.texto}
                </span>
            </div>
            
            <!-- Informações Detalhadas -->
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h5 style="margin-bottom: 15px; color: #333;">📊 Informações Detalhadas</h5>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <strong>🆔 ID do Processo:</strong><br>
                        <code style="font-size: 12px; background: #e9ecef; padding: 2px 4px; border-radius: 3px;">${jobId}</code>
                    </div>
                    <div>
                        <strong>⏱️ Tempo de Processamento:</strong><br>
                        <span>${tempoDecorrido}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <strong>🚀 Início:</strong><br>
                        <span style="font-size: 14px;">${dataInicio}</span>
                    </div>
                    <div>
                        <strong>🏁 Conclusão:</strong><br>
                        <span style="font-size: 14px;">${dataFim}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                    <div>
                        <strong>📋 Total de MLBs:</strong><br>
                        <span style="font-size: 18px; color: #667eea; font-weight: 600;">${totalMLBs}</span>
                    </div>
                    <div>
                        <strong>✅ Processados:</strong><br>
                        <span style="font-size: 18px; color: #333; font-weight: 600;">${processados}</span>
                    </div>
                    <div>
                        <strong>🎯 Encontrados:</strong><br>
                        <span style="font-size: 18px; color: #28a745; font-weight: 600;">${encontrados}</span>
                    </div>
                    <div>
                        <strong>❌ Falhas:</strong><br>
                        <span style="font-size: 18px; color: #dc3545; font-weight: 600;">${falharam}</span>
                    </div>
                </div>
            </div>
            
            <!-- Barra de Progresso -->
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong>📈 Progresso do Processamento</strong>
                    <span style="font-weight: 600; color: #667eea;">${progressoReal}%</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressoReal}%">
                            <div class="progress-text">${progressoReal}%</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Taxa de Sucesso -->
            ${totalMLBs > 0 ? `
                <div style="background: #e8f5e8; border: 1px solid #28a745; border-radius: 8px; padding: 15px; text-align: center; margin-bottom: 20px;">
                    <strong style="color: #28a745;">🎯 Taxa de Sucesso: ${Math.round((encontrados / totalMLBs) * 100)}%</strong>
                    <div style="font-size: 14px; color: #666; margin-top: 5px;">
                        ${encontrados} produtos encontrados de ${totalMLBs} analisados
                    </div>
                </div>
            ` : ''}
            
            <!-- Arquivos Disponíveis -->
            <div style="background: #e8f4fd; border: 1px solid #17a2b8; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <h6 style="margin-bottom: 10px; color: #0c5460;">📁 Arquivos Disponíveis:</h6>
                ${dadosAPI.result.map(file => `
                    <div style="margin: 5px 0;">
                        <a href="${file.url}" class="btn btn-outline" style="font-size: 14px; padding: 5px 10px;">
                            ${file.tipo === 'metadata' ? '📋' : '��'} ${file.nome}
                        </a>
                    </div>
                `).join('')}
            </div>
            
            <!-- Ações Rápidas -->
            <div style="margin-top: 20px; text-align: center;">
                <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-success" style="margin: 5px;">
                    📥 Download Completo
                </a>
                <button class="btn btn-secondary" onclick="verDetalhesJob('${jobId}')" style="margin: 5px;">
                    🔄 Recarregar
                </button>
                <button class="btn btn-warning" onclick="verResultadosDetalhados('${jobId}')" style="margin: 5px;">
                    👁️ Ver Resultados
                </button>
            </div>
        </div>
    `;
    
    document.getElementById('detalhes-job-content').innerHTML = detalhesHtml;
}

function processarDetalhesSemMetadados(jobId, dadosAPI) {
    console.log('⚠️ Processando sem metadados');
    
    const detalhesHtml = `
        <div class="job-tracking">
            <div style="text-align: center; margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
                <div style="font-size: 24px; margin-bottom: 5px;">📦</div>
                <h4 style="margin: 0; font-size: 18px;">Processamento Concluído</h4>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">
                    Detalhes não disponíveis
                </div>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <strong>⚠️ Metadados não disponíveis</strong><br>
                <small>Os detalhes estatísticos não puderam ser carregados, mas os arquivos de resultado estão disponíveis para download.</small>
            </div>
            
            <!-- Arquivos Disponíveis -->
            <div style="background: #e8f4fd; border: 1px solid #17a2b8; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <h6 style="margin-bottom: 10px; color: #0c5460;">📁 Arquivos Disponíveis:</h6>
                ${dadosAPI.result.map(file => `
                    <div style="margin: 5px 0;">
                        <a href="${file.url}" class="btn btn-outline" style="font-size: 14px; padding: 5px 10px;">
                            ${file.tipo === 'metadata' ? '📋' : '📊'} ${file.nome}
                        </a>
                    </div>
                `).join('')}
            </div>
            
            <div style="text-align: center;">
                <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-success">
                    📥 Download Completo
                </a>
            </div>
        </div>
    `;
    
    document.getElementById('detalhes-job-content').innerHTML = detalhesHtml;
}
function processarDetalhesJob(jobId, dadosAPI) {
    console.log('🔧 Processando dados:', dadosAPI);
    
    // Tentar diferentes estruturas de dados
    const job = dadosAPI.job || dadosAPI.data || dadosAPI;
    
    console.log('📋 Job extraído:', job);
    
    // Verificar todas as possíveis propriedades
    const possiveisPropriedades = {
        status: job.status || job.state || 'aguardando',
        progress: job.progress || job.progresso || job.percentage || 0,
        total_mlbs: job.total_mlbs || job.totalMLBs || job.total || job.consultas?.length || 0,
        concluidos: job.concluidos || job.completed || job.success || job.processados || 0,
        falharam: job.falharam || job.failed || job.errors || job.falhas || 0,
        encontrados: job.encontrados || job.found || job.matches || job.resultados || 0,
        tempo_decorrido: job.tempo_decorrido || job.elapsed_time || job.duration || 'Não disponível',
        created_at: job.created_at || job.createdAt || job.timestamp,
        result: job.result || job.results || job.data
    };
    
    console.log('🎯 Propriedades mapeadas:', possiveisPropriedades);
    
    // Calcular progresso real
    let progressoReal = 0;
    if (possiveisPropriedades.status === 'concluido' || possiveisPropriedades.status === 'completed') {
        progressoReal = 100;
    } else if (typeof possiveisPropriedades.progress === 'number') {
        progressoReal = Math.min(100, Math.max(0, possiveisPropriedades.progress));
    }
    
    // Se temos resultados, tentar extrair estatísticas
    if (possiveisPropriedades.result && Array.isArray(possiveisPropriedades.result)) {
        const resultados = possiveisPropriedades.result;
        possiveisPropriedades.total_mlbs = resultados.length;
        possiveisPropriedades.encontrados = resultados.filter(r => r.encontrado || r.found || r.match).length;
        possiveisPropriedades.concluidos = resultados.length;
        possiveisPropriedades.falharam = 0;
    }
    
    // Determinar status em português
    const statusMap = {
        'processando': { texto: 'Processando', cor: '#ffc107', icon: '⚡' },
        'processing': { texto: 'Processando', cor: '#ffc107', icon: '⚡' },
        'aguardando': { texto: 'Na Fila', cor: '#6c757d', icon: '⏳' },
        'waiting': { texto: 'Na Fila', cor: '#6c757d', icon: '⏳' },
        'concluido': { texto: 'Concluído', cor: '#28a745', icon: '✅' },
        'completed': { texto: 'Concluído', cor: '#28a745', icon: '✅' },
        'cancelado': { texto: 'Cancelado', cor: '#dc3545', icon: '❌' },
        'cancelled': { texto: 'Cancelado', cor: '#dc3545', icon: '❌' },
        'erro': { texto: 'Com Erro', cor: '#dc3545', icon: '⚠️' },
        'error': { texto: 'Com Erro', cor: '#dc3545', icon: '⚠️' }
    };
    
    const statusInfo = statusMap[possiveisPropriedades.status] || statusMap['aguardando'];
    
    // Gerar nome amigável
    const agora = new Date();
    const dataProcessamento = agora.toLocaleDateString('pt-BR');
    const horaProcessamento = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    const detalhesHtml = `
        <div class="job-tracking">
            <!-- Cabeçalho do Job -->
            <div style="text-align: center; margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
                <div style="font-size: 24px; margin-bottom: 5px;">📦</div>
                <h4 style="margin: 0; font-size: 18px;">Detecção de Dois Volumes</h4>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">
                    ${dataProcessamento} ${horaProcessamento}
                </div>
            </div>
            
            <!-- Status Atual -->
            <div style="display: flex; justify-content: center; margin-bottom: 20px;">
                <span style="background: ${statusInfo.cor}; color: white; padding: 8px 16px; border-radius: 20px; font-weight: 600;">
                    ${statusInfo.icon} ${statusInfo.texto}
                </span>
            </div>
            
            <!-- DEBUG INFO -->
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <strong>🐛 Valores encontrados:</strong><br>
                <small>
                    Status: ${possiveisPropriedades.status}<br>
                    Total MLBs: ${possiveisPropriedades.total_mlbs}<br>
                    Concluídos: ${possiveisPropriedades.concluidos}<br>
                    Encontrados: ${possiveisPropriedades.encontrados}<br>
                    Falharam: ${possiveisPropriedades.falharam}<br>
                    Progress: ${possiveisPropriedades.progress}<br>
                    Progresso Real: ${progressoReal}%
                </small>
            </div>
            
            <!-- Informações Detalhadas -->
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h5 style="margin-bottom: 15px; color: #333;">📊 Informações Detalhadas</h5>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <strong>🆔 ID do Processo:</strong><br>
                        <code style="font-size: 12px; background: #e9ecef; padding: 2px 4px; border-radius: 3px;">${jobId}</code>
                    </div>
                    <div>
                        <strong>⏱️ Tempo Decorrido:</strong><br>
                        <span>${possiveisPropriedades.tempo_decorrido}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                    <div>
                        <strong>📋 Total de MLBs:</strong><br>
                        <span style="font-size: 18px; color: #667eea; font-weight: 600;">${possiveisPropriedades.total_mlbs}</span>
                    </div>
                    <div>
                        <strong>✅ Processados:</strong><br>
                        <span style="font-size: 18px; color: #333; font-weight: 600;">${possiveisPropriedades.concluidos + possiveisPropriedades.falharam}</span>
                    </div>
                    <div>
                        <strong>🎯 Encontrados:</strong><br>
                        <span style="font-size: 18px; color: #28a745; font-weight: 600;">${possiveisPropriedades.encontrados}</span>
                    </div>
                    <div>
                        <strong>❌ Falhas:</strong><br>
                        <span style="font-size: 18px; color: #dc3545; font-weight: 600;">${possiveisPropriedades.falharam}</span>
                    </div>
                </div>
            </div>
            
            <!-- Barra de Progresso -->
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong>📈 Progresso do Processamento</strong>
                    <span style="font-weight: 600; color: #667eea;">${progressoReal}%</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressoReal}%">
                            <div class="progress-text">${progressoReal}%</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Taxa de Sucesso -->
            ${possiveisPropriedades.total_mlbs > 0 ? `
                <div style="background: #e8f5e8; border: 1px solid #28a745; border-radius: 8px; padding: 15px; text-align: center;">
                    <strong style="color: #28a745;">🎯 Taxa de Sucesso: ${Math.round((possiveisPropriedades.encontrados / possiveisPropriedades.total_mlbs) * 100)}%</strong>
                    <div style="font-size: 14px; color: #666; margin-top: 5px;">
                        ${possiveisPropriedades.encontrados} produtos encontrados de ${possiveisPropriedades.total_mlbs} analisados
                    </div>
                </div>
            ` : ''}
            
            <!-- Ações Rápidas -->
            <div style="margin-top: 20px; text-align: center;">
                ${possiveisPropriedades.status === 'concluido' || possiveisPropriedades.status === 'completed' ? `
                    <a href="/api/pesquisa-descricao/download/${jobId}" class="btn btn-success" style="margin: 5px;">
                        📥 Download Resultados
                    </a>
                ` : ''}
                <button class="btn btn-secondary" onclick="verDetalhesJob('${jobId}')" style="margin: 5px;">
                    🔄 Recarregar
                </button>
            </div>
        </div>
    `;
    
    document.getElementById('detalhes-job-content').innerHTML = detalhesHtml;
}

function fecharModalDetalhes() {
    document.getElementById('modal-detalhes-job').style.display = 'none';
}

async function cancelarJob(jobId) {
    if (!confirm(`Tem certeza que deseja cancelar o processo ${jobId}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/pesquisa-descricao/cancelar/${jobId}`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.ok) {
            alert('✅ Processo cancelado com sucesso!');
            atualizarMonitoramento();
        } else {
            alert('❌ Erro ao cancelar: ' + (data.message || data.error));
        }
    } catch (error) {
        alert('❌ Erro: ' + error.message);
    }
}

// Funções auxiliares - CORRIGIDAS
function contarMLBs(texto) {
    const mlbs = extrairMLBs(texto);
    const validos = mlbs.filter(mlb => /^MLB\d{10,12}$/i.test(mlb));
    
    return {
        total: mlbs.length,
        validos: validos.length,
        invalidos: mlbs.length - validos.length
    };
}

function extrairMLBs(texto) {
    if (!texto) return [];
    
    // Extrair MLBs do texto (formato MLB + 10-12 dígitos)
    const matches = texto.match(/MLB\d{10,12}/gi) || [];
    
    // Remover duplicatas e converter para uppercase
    return [...new Set(matches.map(mlb => mlb.toUpperCase()))];
}

function exibirResultados(data, tipo) {
    const container = document.getElementById('results-container');
    const statsContainer = document.getElementById('results-stats');
    const contentContainer = document.getElementById('results-content');

    // Estatísticas
    statsContainer.innerHTML = `
        <div class="stat-card">
            <div class="stat-number">${data.total_processados || 0}</div>
            <div class="stat-label">Total Processados</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.total_encontrados || 0}</div>
            <div class="stat-label">Encontrados</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.tempo_processamento || '0s'}</div>
            <div class="stat-label">Tempo</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.total_processados ? Math.round((data.total_encontrados / data.total_processados) * 100) : 0}%</div>
            <div class="stat-label">Taxa de Sucesso</div>
        </div>
    `;

    // Resultados
    if (data.resultados && data.resultados.length > 0) {
        contentContainer.innerHTML = `
            <div style="max-height: 400px; overflow-y: auto;">
                ${data.resultados.map(resultado => `
                    <div style="background: white; margin: 10px 0; padding: 15px; border-radius: 8px; border-left: 4px solid ${resultado.encontrado ? '#28a745' : '#6c757d'};">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>${resultado.mlb_id}</strong>
                            <span style="background: ${resultado.encontrado ? '#d4edda' : '#e2e3e5'}; color: ${resultado.encontrado ? '#155724' : '#383d41'}; padding: 3px 8px; border-radius: 12px; font-size: 12px;">
                                ${resultado.encontrado ? '✅ Encontrado' : '❌ Não encontrado'}
                            </span>
                        </div>
                        ${resultado.titulo ? `<div style="margin: 5px 0; color: #666;">${resultado.titulo}</div>` : ''}
                        ${resultado.detalhes ? `<div style="margin: 5px 0; font-size: 14px;">${resultado.detalhes}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        contentContainer.innerHTML = '<p style="text-align: center; padding: 20px;">Nenhum resultado para exibir.</p>';
    }

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

function fecharResultados() {
    document.getElementById('results-container').style.display = 'none';
}

function exportarResultados() {
    alert('🚧 Funcionalidade de exportação em desenvolvimento');
}

// Event listeners para modais
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Event listeners para campos de tipo
document.getElementById('tipo-modal').addEventListener('change', function() {
    const grupoTexto = document.getElementById('grupo-texto-modal');
    if (this.value === 'pesquisar_texto') {
        grupoTexto.style.display = 'block';
    } else {
        grupoTexto.style.display = 'none';
    }
});

// Limpeza ao sair da página
window.addEventListener('beforeunload', function() {
    pararMonitoramentoAutomatico();
});