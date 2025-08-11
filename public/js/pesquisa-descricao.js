document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('pesquisaForm');
    const loadingDiv = document.getElementById('loading');
    const resultadosDiv = document.getElementById('resultados');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const resumoDiv = document.getElementById('resumo');
    const listaResultadosDiv = document.getElementById('listaResultados');
    const downloadSection = document.getElementById('downloadSection');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // Elementos dos checkboxes
    const detectarDoisVolumesCheckbox = document.getElementById('detectarDoisVolumes');
    const habilitarPesquisaTextoCheckbox = document.getElementById('habilitarPesquisaTexto');
    const textoContainer = document.getElementById('textoContainer');
    const pesquisaTextoContainer = document.getElementById('pesquisaTextoContainer');
    
    let resultadosData = null;

    // Controle de visibilidade dos campos
    detectarDoisVolumesCheckbox.addEventListener('change', function() {
        if (this.checked) {
            pesquisaTextoContainer.style.display = 'none';
            habilitarPesquisaTextoCheckbox.checked = false;
            textoContainer.style.display = 'none';
        } else {
            pesquisaTextoContainer.style.display = 'block';
        }
    });

    habilitarPesquisaTextoCheckbox.addEventListener('change', function() {
        if (this.checked) {
            textoContainer.style.display = 'block';
            document.getElementById('texto').focus();
        } else {
            textoContainer.style.display = 'none';
        }
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const mlbsText = document.getElementById('mlbs').value.trim();
        const detectarDoisVolumes = detectarDoisVolumesCheckbox.checked;
        const habilitarPesquisaTexto = habilitarPesquisaTextoCheckbox.checked;
        const texto = document.getElementById('texto').value.trim();
        
        if (!mlbsText) {
            alert('Por favor, insira pelo menos um MLB.');
            return;
        }

        // Validação: pelo menos uma opção deve estar selecionada
        if (!detectarDoisVolumes && !habilitarPesquisaTexto) {
            alert('Por favor, selecione pelo menos uma opção de pesquisa.');
            return;
        }

        // Se pesquisa de texto estiver habilitada, o texto é obrigatório
        if (habilitarPesquisaTexto && !texto) {
            alert('Por favor, digite o texto que deseja pesquisar.');
            document.getElementById('texto').focus();
            return;
        }

        const mlbs = mlbsText.split('\n')
            .map(mlb => mlb.trim())
            .filter(mlb => mlb.length > 0);

        if (mlbs.length === 0) {
            alert('Por favor, insira MLBs válidos.');
            return;
        }

        // Mostrar loading
        loadingDiv.style.display = 'block';
        resultadosDiv.style.display = 'none';
        progressBar.style.width = '0%';
        progressText.textContent = 'Iniciando...';

        try {
            const requestBody = {
                mlb_ids: mlbs
            };

            // Adicionar parâmetros baseados nas opções selecionadas
            if (detectarDoisVolumes) {
                requestBody.detectar_dois_volumes = true;
            }
            
            if (habilitarPesquisaTexto && texto) {
                requestBody.texto = texto;
            }

            const response = await fetch('/api/pesquisa-descricao/pesquisar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                resultadosData = data;
                exibirResultados(data, detectarDoisVolumes, habilitarPesquisaTexto, texto);
            } else {
                throw new Error(data.message || 'Erro desconhecido');
            }

        } catch (error) {
            console.error('Erro na pesquisa:', error);
            alert(`Erro ao realizar pesquisa: ${error.message}`);
        } finally {
            loadingDiv.style.display = 'none';
        }
    });

    function exibirResultados(data, isDeteccaoDoisVolumes, isPesquisaTexto, textoPesquisado) {
        const { resultados, total_processados, total_encontrados, tempo_execucao } = data;
        
        // Resumo
        let resumoHTML = `
            <strong>Processamento concluído!</strong><br>
            <i class="fas fa-list me-1"></i> Total processado: ${total_processados}<br>
            <i class="fas fa-check me-1"></i> Total encontrado: ${total_encontrados}<br>
            <i class="fas fa-clock me-1"></i> Tempo: ${tempo_execucao}
        `;

        if (isDeteccaoDoisVolumes) {
            resumoHTML += `<br><i class="fas fa-boxes me-1"></i> Modo: Detecção de produtos com 2 volumes`;
        } else if (isPesquisaTexto) {
            resumoHTML += `<br><i class="fas fa-search me-1"></i> Texto pesquisado: "${textoPesquisado}"`;
        }

        resumoDiv.innerHTML = resumoHTML;

        // Lista de resultados
        let listaHTML = '';
        
        resultados.forEach(resultado => {
            const { mlb, encontrado, titulo, descricao_encontrada, trecho_relevante, erro, deteccao_dois_volumes } = resultado;
            
            let cssClass = 'result-item';
            let icone = 'fas fa-circle';
            let status = '';
            
            if (erro) {
                cssClass += ' nao-encontrado';
                icone = 'fas fa-exclamation-triangle';
                status = 'Erro';
            } else if (isDeteccaoDoisVolumes) {
                if (deteccao_dois_volumes && deteccao_dois_volumes.detectado) {
                    cssClass += ' volume-detected';
                    icone = 'fas fa-boxes';
                    status = '2 Volumes Detectado';
                } else {
                    cssClass += ' nao-encontrado';
                    icone = 'fas fa-box';
                    status = 'Volume único';
                }
            } else if (encontrado) {
                cssClass += ' encontrado';
                icone = 'fas fa-check-circle';
                status = 'Encontrado';
            } else {
                cssClass += ' nao-encontrado';
                icone = 'fas fa-times-circle';
                status = 'Não encontrado';
            }

            listaHTML += `
                <div class="${cssClass}">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">
                                <i class="${icone} me-2"></i>
                                ${mlb}
                                <span class="badge bg-secondary ms-2">${status}</span>
                            </h6>
                            ${titulo ? `<p class="mb-1"><strong>Título:</strong> ${titulo}</p>` : ''}
                            ${erro ? `<p class="text-danger mb-1"><strong>Erro:</strong> ${erro}</p>` : ''}
                            
                            ${isDeteccaoDoisVolumes && deteccao_dois_volumes && deteccao_dois_volumes.detectado ? `
                                <div class="detection-highlight">
                                    <strong><i class="fas fa-search me-1"></i>Padrão detectado:</strong> ${deteccao_dois_volumes.padrao_detectado}<br>
                                    <strong><i class="fas fa-quote-left me-1"></i>Trecho:</strong> "${deteccao_dois_volumes.trecho_detectado}"
                                </div>
                            ` : ''}
                            
                            ${trecho_relevante && !isDeteccaoDoisVolumes ? `
                                <div class="detection-highlight">
                                    <strong><i class="fas fa-quote-left me-1"></i>Trecho encontrado:</strong> "${trecho_relevante}"
                                </div>
                            ` : ''}
                        </div>
                        <div class="ms-3">
                            <a href="https://produto.mercadolivre.com.br/${mlb}" 
                                
                               class="btn btn-outline-primary btn-sm">
                                <i class="fas fa-external-link-alt me-1"></i>
                                Ver produto
                            </a>
                        </div>
                    </div>
                </div>
            `;
        });

        listaResultadosDiv.innerHTML = listaHTML;
        resultadosDiv.style.display = 'block';

        // Mostrar botão de download se houver resultados encontrados
        if (total_encontrados > 0) {
            downloadSection.style.display = 'block';
        }
    }

    // Download dos resultados
    downloadBtn.addEventListener('click', function() {
        if (!resultadosData) return;

        const { resultados } = resultadosData;
        const isDeteccaoDoisVolumes = detectarDoisVolumesCheckbox.checked;
        
        let conteudo = '';
        
        if (isDeteccaoDoisVolumes) {
            conteudo = '=== PRODUTOS COM 2 VOLUMES DETECTADOS ===\n\n';
            
            const produtosDoisVolumes = resultados.filter(r => 
                r.deteccao_dois_volumes && r.deteccao_dois_volumes.detectado
            );
            
            produtosDoisVolumes.forEach(resultado => {
                conteudo += `MLB: ${resultado.mlb}\n`;
                conteudo += `Título: ${resultado.titulo || 'N/A'}\n`;
                conteudo += `Padrão detectado: ${resultado.deteccao_dois_volumes.padrao_detectado}\n`;
                conteudo += `Trecho: "${resultado.deteccao_dois_volumes.trecho_detectado}"\n`;
                conteudo += `Link: https://produto.mercadolivre.com.br/${resultado.mlb}\n`;
                conteudo += '---\n\n';
            });
            
            if (produtosDoisVolumes.length === 0) {
                conteudo += 'Nenhum produto com 2 volumes foi detectado.\n';
            }
        } else {
            conteudo = '=== RESULTADOS DA PESQUISA ===\n\n';
            
            const resultadosEncontrados = resultados.filter(r => r.encontrado);
            
            resultadosEncontrados.forEach(resultado => {
                conteudo += `MLB: ${resultado.mlb}\n`;
                conteudo += `Título: ${resultado.titulo || 'N/A'}\n`;
                if (resultado.trecho_relevante) {
                    conteudo += `Trecho encontrado: "${resultado.trecho_relevante}"\n`;
                }
                conteudo += `Link: https://produto.mercadolivre.com.br/${resultado.mlb}\n`;
                conteudo += '---\n\n';
            });
            
            if (resultadosEncontrados.length === 0) {
                conteudo += 'Nenhum resultado encontrado.\n';
            }
        }

        // Criar e baixar arquivo
        const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const tipoArquivo = isDeteccaoDoisVolumes ? 'produtos-2-volumes' : 'resultados-pesquisa';
        a.download = `${tipoArquivo}-${timestamp}.txt`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    });
});