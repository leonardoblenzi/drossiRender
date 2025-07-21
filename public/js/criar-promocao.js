class CriarPromocaoManager {
    constructor() {
        this.userId = localStorage.getItem('userId');
        this.initializeEventListeners();
        this.setupDateDefaults();
    }

    initializeEventListeners() {
        // Consultar item - CORRIGIDO
        document.getElementById('consultarItemBtn')?.addEventListener('click', () => {
            this.consultarItem();
        });

        // Criar promoção unitária - CORRIGIDO (não existe botão, é chamado direto)
        // A função criarPromocaoIndividual() já existe no HTML

        // Upload de arquivo
        const uploadBox = document.getElementById('uploadBox');
        const csvFile = document.getElementById('csvFile');

        if (uploadBox && csvFile) {
            uploadBox.addEventListener('click', () => csvFile.click());
            uploadBox.addEventListener('dragover', this.handleDragOver.bind(this));
            uploadBox.addEventListener('drop', this.handleDrop.bind(this));
            csvFile.addEventListener('change', this.handleFileSelect.bind(this));
        }

        // Processar massa
        document.getElementById('processarMassaBtn')?.addEventListener('click', () => {
            this.processarPromocoesMassa();
        });

        // Consultar promoções disponíveis
        document.getElementById('consultarPromocoesBtn')?.addEventListener('click', () => {
            this.consultarPromocoesDisponiveis();
        });

        // Download template
        document.getElementById('downloadTemplateBtn')?.addEventListener('click', () => {
            this.downloadTemplate();
        });

        // Mudança de tipo de promoção - CORRIGIDO
        document.getElementById('tipoPromocao')?.addEventListener('change', () => {
            this.toggleFormFields();
        });
    }

    setupDateDefaults() {
        // Data de início será sempre "agora" no backend
        // Apenas configurar data fim como opcional
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        
        // Deixar data fim vazia por padrão (opcional)
        // document.getElementById('data_fim').value = this.formatDateForInput(nextWeek);
    }

    formatDateForInput(date) {
        return date.toISOString().slice(0, 16);
    }

    formatDateForAPI(dateString) {
        return new Date(dateString).toISOString();
    }

    toggleFormFields() {
        const tipo = document.getElementById('tipoPromocao')?.value;
        // Aqui você pode adicionar lógica específica para cada tipo
        console.log('Tipo selecionado:', tipo);
    }

    async consultarItem() {
        const itemId = document.getElementById('itemId')?.value?.trim(); // CORRIGIDO
        
        if (!itemId) {
            this.showError('Digite o ID do item');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`/api/criar-promocao/item/${itemId}?userId=${this.userId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (result.success) {
                this.displayItemInfo(result.data);
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            this.showError('Erro ao consultar item: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    displayItemInfo(item) {
        const infoDiv = document.getElementById('item-info');
        
        if (!infoDiv) return;
        
        // Salvar preço globalmente para uso posterior
        window.ultimoPrecoConsultado = parseFloat(item.item?.price || item.price || 0);
        
        const itemData = item.item || item;
        const resumo = item.resumo || {};
        
        let promocoesHtml = '';
        
        if (resumo.ativas && resumo.ativas.length > 0) {
            promocoesHtml += `
                <div class="item-detail">
                    <span><strong>🎯 Participando Ativamente:</strong></span>
                    <span>${resumo.ativas.join(', ')}</span>
                </div>
            `;
        }
        
        if (resumo.disponiveis && resumo.disponiveis.length > 0) {
            promocoesHtml += `
                <div class="item-detail">
                    <span><strong>📋 Campanhas Disponíveis:</strong></span>
                    <span>${resumo.disponiveis.join(', ')}</span>
                </div>
            `;
        }
        
        if (resumo.automaticas && resumo.automaticas.length > 0) {
            promocoesHtml += `
                <div class="item-detail">
                    <span><strong>🤖 Promoções Automáticas:</strong></span>
                    <span>${resumo.automaticas.join(', ')}</span>
                </div>
            `;
        }
        
        infoDiv.innerHTML = `
            <div class="item-info">
                <h4>📋 Informações do Item</h4>
                <div class="item-detail">
                    <span><strong>Título:</strong></span>
                    <span>${itemData.title}</span>
                </div>
                <div class="item-detail">
                    <span><strong>Preço Atual:</strong></span>
                    <span>R\$ ${itemData.price}</span>
                </div>
                <div class="item-detail">
                    <span><strong>Status:</strong></span>
                    <span class="status-badge ${itemData.status === 'active' ? 'success' : 'error'}">${itemData.status}</span>
                </div>
                <div class="item-detail">
                    <span><strong>Categoria:</strong></span>
                    <span>${itemData.category_id || 'N/A'}</span>
                </div>
                <div class="item-detail">
                    <span><strong>Vendas:</strong></span>
                    <span>${itemData.sold_quantity || 0}</span>
                </div>
                <div class="item-detail">
                    <span><strong>Pode Criar Promoção:</strong></span>
                    <span class="status-badge ${item.pode_criar_promocao ? 'success' : 'error'}">
                        ${item.pode_criar_promocao ? 'Sim' : 'Não'}
                    </span>
                </div>
                ${promocoesHtml}
            </div>
        `;
        
        infoDiv.style.display = 'block';
        
        // Sugerir preço promocional (10% de desconto)
        const precoSugerido = (itemData.price * 0.9).toFixed(2);
        const precoInput = document.getElementById('precoPromocional');
        if (precoInput) {
            precoInput.value = precoSugerido;
        }
    }
       // NOVA FUNÇÃO: Criar promoção (chamada pelo HTML) - CORRIGIDA
async criarPromocaoIndividual() {
    console.log('🎯 Função criarPromocaoIndividual() foi chamada!');
    
    // Debug: Verificar se todos os elementos existem
    const elementos = {
        itemId: document.getElementById('itemId'),
        precoPromocional: document.getElementById('precoPromocional'),
        data_fim: document.getElementById('data_fim'),
        tipoPromocao: document.getElementById('tipoPromocao'),
        campanhaEspecifica: document.getElementById('campanhaEspecifica'),
        descontoMaximo: document.getElementById('descontoMaximo')
    };
    
    console.log('🔍 Debug dos elementos encontrados:');
    Object.keys(elementos).forEach(key => {
        console.log(`  - ${key}:`, elementos[key] ? '✅ Encontrado' : '❌ NULL');
        if (elementos[key]) {
            console.log(`    Valor: "${elementos[key].value}"`);
        }
    });
    
    // Verificar elementos obrigatórios
    if (!elementos.itemId) {
        alert('❌ Elemento itemId não encontrado no HTML!');
        return;
    }
    
    if (!elementos.precoPromocional) {
        alert('❌ Elemento precoPromocional não encontrado no HTML!');
        return;
    }
    
    if (!elementos.tipoPromocao) {
        alert('❌ Elemento tipoPromocao não encontrado no HTML!');
        return;
    }
    
    // Capturar valores com verificação de segurança
    const itemId = elementos.itemId.value?.trim();
    const price = elementos.precoPromocional.value?.trim();
    const endDate = elementos.data_fim?.value?.trim() || '';
    const tipo = elementos.tipoPromocao.value?.trim();

    console.log('📋 Valores capturados (após verificação):');
    console.log('  - itemId:', itemId);
    console.log('  - price:', price);
    console.log('  - endDate:', endDate);
    console.log('  - tipo:', tipo);

    // Validações básicas
    if (!itemId) {
        alert('❌ Digite o ID do item primeiro');
        return;
    }
    
    if (!tipo) {
        alert('❌ Selecione o tipo de promoção');
        return;
    }
    
    if (!price) {
        alert('❌ Digite o preço promocional');
        return;
    }

    console.log('✅ Validação passou, iniciando requisição...');
    
    // Mostrar loading se existir
    const loadingSpan = document.getElementById('criar-loading');
    if (loadingSpan) {
        loadingSpan.style.display = 'inline-block';
    }

    try {
        let endpoint, payload;
        
        // CORRIGIDO: Obter userId do localStorage diretamente
        const userId = localStorage.getItem('userId') || 'default';
        
        // Preparar dados baseado no tipo
        if (tipo === 'PRICE_DISCOUNT') {
            endpoint = `/api/criar-promocao/desconto-unitario/${itemId}`;
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                price: parseFloat(price),
                end_date: endDate ? new Date(endDate).toISOString() : null
            };
        } else if (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN') {
            // Para campanhas específicas
            endpoint = `/api/criar-promocao/promocao-individual/${itemId}`;
            
            const campanhaId = elementos.campanhaEspecifica?.value || '';
            const campanhaNome = elementos.campanhaEspecifica?.selectedOptions[0]?.text || '';
            
            console.log('📋 Dados da campanha:');
            console.log('  - campanhaId:', campanhaId);
            console.log('  - campanhaNome:', campanhaNome);
            
            if (!campanhaId && (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN')) {
                alert('❌ Selecione uma campanha específica para este tipo de promoção');
                return;
            }
            
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                tipo: tipo,
                preco_promocional: price,
                data_fim: endDate,
                campanha_id: campanhaId,
                campanha_nome: campanhaNome
            };
        } else if (tipo === 'DEAL_AUTO') {
            endpoint = `/api/criar-promocao/promocao-individual/${itemId}`;
            
            const descontoMaximo = elementos.descontoMaximo?.value || null;
            
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                tipo: tipo,
                preco_promocional: price,
                data_fim: endDate,
                desconto_maximo: descontoMaximo ? parseFloat(descontoMaximo) : null
            };
        } else {
            throw new Error(`Tipo de promoção '${tipo}' não suportado`);
        }

        console.log('📡 Endpoint:', endpoint);
        console.log('📦 Payload:', payload);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('📡 Response status:', response.status);
        
        const result = await response.json();
        console.log('📋 Response data:', result);

        if (result.success) {
            // Mostrar sucesso
            const resultDiv = document.getElementById('resultado-promocao');
            if (resultDiv) {
                resultDiv.className = 'result success';
                resultDiv.innerHTML = `
                    <h4>✅ Promoção criada com sucesso!</h4>
                    <p><strong>Item:</strong> ${itemId}</p>
                    <p><strong>Tipo:</strong> ${tipo}</p>
                    <p><strong>Preço:</strong> R\$ ${price}</p>
                    ${result.message ? `<p><strong>Detalhes:</strong> ${result.message}</p>` : ''}
                    ${result.data?.titulo ? `<p><strong>Título:</strong> ${result.data.titulo}</p>` : ''}
                    ${result.data?.preco_antes ? `<p><strong>Preço antes:</strong> R\$ ${result.data.preco_antes}</p>` : ''}
                    ${result.data?.preco_depois ? `<p><strong>Preço depois:</strong> R\$ ${result.data.preco_depois}</p>` : ''}
                    ${result.data?.campanha_escolhida ? `<p><strong>Campanha:</strong> ${result.data.campanha_escolhida}</p>` : ''}
                    ${result.data?.desconto_aplicado ? `<p><strong>Desconto aplicado:</strong> ${result.data.desconto_aplicado}%</p>` : ''}
                `;
                resultDiv.style.display = 'block';
            } else {
                alert('✅ Promoção criada com sucesso!');
            }
            
            // Limpar formulário - CORRIGIDO: chamar função global
            clearFormulario();
        } else {
            // Mostrar erro
            const resultDiv = document.getElementById('resultado-promocao');
            if (resultDiv) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = `
                    <h4>❌ Erro ao criar promoção</h4>
                    <p>${result.message || 'Erro desconhecido'}</p>
                    ${result.data?.metodos_tentados ? `
                        <p><strong>Detalhes:</strong></p>
                        <ul>${result.data.metodos_tentados.map(m => `<li>${m}</li>`).join('')}</ul>
                    ` : ''}
                `;
                resultDiv.style.display = 'block';
            } else {
                alert(`❌ Erro: ${result.message || 'Erro desconhecido'}`);
            }
        }
    } catch (error) {
        console.error('❌ Erro completo:', error);
        
        const resultDiv = document.getElementById('resultado-promocao');
        if (resultDiv) {
            resultDiv.className = 'result error';
            resultDiv.innerHTML = `
                <h4>❌ Erro na requisição</h4>
                <p>${error.message}</p>
            `;
            resultDiv.style.display = 'block';
        } else {
            alert(`❌ Erro: ${error.message}`);
        }
    } finally {
        // Esconder loading
        if (loadingSpan) {
            loadingSpan.style.display = 'none';
        }
    }
}

    // Resto das funções permanecem iguais...
    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        if (!file.name.endsWith('.csv')) {
            this.showError('Apenas arquivos CSV são permitidos');
            return;
        }

        const uploadBox = document.getElementById('uploadBox');
        if (uploadBox) {
            uploadBox.innerHTML = `
                <div class="upload-icon">✅</div>
                <p>Arquivo selecionado: ${file.name}</p>
                <p>Tamanho: ${(file.size / 1024).toFixed(2)} KB</p>
            `;
        }

        const btnProcessar = document.getElementById('processarMassaBtn');
        if (btnProcessar) {
            btnProcessar.disabled = false;
        }
    }

    clearUnitaryForm() {
        const itemIdInput = document.getElementById('itemId'); // CORRIGIDO
        const precoInput = document.getElementById('precoPromocional');
        const dataFimInput = document.getElementById('data_fim'); // CORRIGIDO
        const itemInfo = document.getElementById('item-info');

        if (itemIdInput) itemIdInput.value = '';
        if (precoInput) precoInput.value = '';
        if (dataFimInput) dataFimInput.value = '';
        if (itemInfo) itemInfo.style.display = 'none';
    }

    showLoading(show) {
        const modal = document.getElementById('loadingModal');
        if (modal) {
            modal.style.display = show ? 'block' : 'none';
        }
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }
       // NOVA FUNÇÃO: Criar promoção (chamada pelo HTML) - CORRIGIDA
async criarPromocaoIndividual() {
    console.log('🎯 Função criarPromocaoIndividual() foi chamada!');
    
    // Debug: Verificar se todos os elementos existem
    const elementos = {
        itemId: document.getElementById('itemId'),
        precoPromocional: document.getElementById('precoPromocional'),
        data_fim: document.getElementById('data_fim'),
        tipoPromocao: document.getElementById('tipoPromocao'),
        campanhaEspecifica: document.getElementById('campanhaEspecifica'),
        descontoMaximo: document.getElementById('descontoMaximo')
    };
    
    console.log('🔍 Debug dos elementos encontrados:');
    Object.keys(elementos).forEach(key => {
        console.log(`  - ${key}:`, elementos[key] ? '✅ Encontrado' : '❌ NULL');
        if (elementos[key]) {
            console.log(`    Valor: "${elementos[key].value}"`);
        }
    });
    
    // Verificar elementos obrigatórios
    if (!elementos.itemId) {
        alert('❌ Elemento itemId não encontrado no HTML!');
        return;
    }
    
    if (!elementos.precoPromocional) {
        alert('❌ Elemento precoPromocional não encontrado no HTML!');
        return;
    }
    
    if (!elementos.tipoPromocao) {
        alert('❌ Elemento tipoPromocao não encontrado no HTML!');
        return;
    }
    
    // Capturar valores com verificação de segurança
    const itemId = elementos.itemId.value?.trim();
    const price = elementos.precoPromocional.value?.trim();
    const endDate = elementos.data_fim?.value?.trim() || '';
    const tipo = elementos.tipoPromocao.value?.trim();

    console.log('📋 Valores capturados (após verificação):');
    console.log('  - itemId:', itemId);
    console.log('  - price:', price);
    console.log('  - endDate:', endDate);
    console.log('  - tipo:', tipo);

    // Validações básicas
    if (!itemId) {
        alert('❌ Digite o ID do item primeiro');
        return;
    }
    
    if (!tipo) {
        alert('❌ Selecione o tipo de promoção');
        return;
    }
    
    if (!price) {
        alert('❌ Digite o preço promocional');
        return;
    }

    console.log('✅ Validação passou, iniciando requisição...');
    
    // Mostrar loading se existir
    const loadingSpan = document.getElementById('criar-loading');
    if (loadingSpan) {
        loadingSpan.style.display = 'inline-block';
    }

    try {
        let endpoint, payload;
        
        // CORRIGIDO: Obter userId do localStorage diretamente
        const userId = localStorage.getItem('userId') || 'default';
        
        // Preparar dados baseado no tipo
        if (tipo === 'PRICE_DISCOUNT') {
            endpoint = `/api/criar-promocao/desconto-unitario/${itemId}`;
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                price: parseFloat(price),
                end_date: endDate ? new Date(endDate).toISOString() : null
            };
        } else if (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN') {
            // Para campanhas específicas
            endpoint = `/api/criar-promocao/promocao-individual/${itemId}`;
            
            const campanhaId = elementos.campanhaEspecifica?.value || '';
            const campanhaNome = elementos.campanhaEspecifica?.selectedOptions[0]?.text || '';
            
            console.log('📋 Dados da campanha:');
            console.log('  - campanhaId:', campanhaId);
            console.log('  - campanhaNome:', campanhaNome);
            
            if (!campanhaId && (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN')) {
                alert('❌ Selecione uma campanha específica para este tipo de promoção');
                return;
            }
            
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                tipo: tipo,
                preco_promocional: price,
                data_fim: endDate,
                campanha_id: campanhaId,
                campanha_nome: campanhaNome
            };
        } else if (tipo === 'DEAL_AUTO') {
            endpoint = `/api/criar-promocao/promocao-individual/${itemId}`;
            
            const descontoMaximo = elementos.descontoMaximo?.value || null;
            
            payload = {
                userId: userId, // CORRIGIDO: sem this.
                tipo: tipo,
                preco_promocional: price,
                data_fim: endDate,
                desconto_maximo: descontoMaximo ? parseFloat(descontoMaximo) : null
            };
        } else {
            throw new Error(`Tipo de promoção '${tipo}' não suportado`);
        }

        console.log('📡 Endpoint:', endpoint);
        console.log('📦 Payload:', payload);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('📡 Response status:', response.status);
        
        const result = await response.json();
        console.log('📋 Response data:', result);

        if (result.success) {
            // Mostrar sucesso
            const resultDiv = document.getElementById('resultado-promocao');
            if (resultDiv) {
                resultDiv.className = 'result success';
                resultDiv.innerHTML = `
                    <h4>✅ Promoção criada com sucesso!</h4>
                    <p><strong>Item:</strong> ${itemId}</p>
                    <p><strong>Tipo:</strong> ${tipo}</p>
                    <p><strong>Preço:</strong> R\$ ${price}</p>
                    ${result.message ? `<p><strong>Detalhes:</strong> ${result.message}</p>` : ''}
                    ${result.data?.titulo ? `<p><strong>Título:</strong> ${result.data.titulo}</p>` : ''}
                    ${result.data?.preco_antes ? `<p><strong>Preço antes:</strong> R\$ ${result.data.preco_antes}</p>` : ''}
                    ${result.data?.preco_depois ? `<p><strong>Preço depois:</strong> R\$ ${result.data.preco_depois}</p>` : ''}
                    ${result.data?.campanha_escolhida ? `<p><strong>Campanha:</strong> ${result.data.campanha_escolhida}</p>` : ''}
                    ${result.data?.desconto_aplicado ? `<p><strong>Desconto aplicado:</strong> ${result.data.desconto_aplicado}%</p>` : ''}
                `;
                resultDiv.style.display = 'block';
            } else {
                alert('✅ Promoção criada com sucesso!');
            }
            
            // Limpar formulário - CORRIGIDO: chamar função global
            clearFormulario();
        } else {
            // Mostrar erro
            const resultDiv = document.getElementById('resultado-promocao');
            if (resultDiv) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = `
                    <h4>❌ Erro ao criar promoção</h4>
                    <p>${result.message || 'Erro desconhecido'}</p>
                    ${result.data?.metodos_tentados ? `
                        <p><strong>Detalhes:</strong></p>
                        <ul>${result.data.metodos_tentados.map(m => `<li>${m}</li>`).join('')}</ul>
                    ` : ''}
                `;
                resultDiv.style.display = 'block';
            } else {
                alert(`❌ Erro: ${result.message || 'Erro desconhecido'}`);
            }
        }
    } catch (error) {
        console.error('❌ Erro completo:', error);
        
        const resultDiv = document.getElementById('resultado-promocao');
        if (resultDiv) {
            resultDiv.className = 'result error';
            resultDiv.innerHTML = `
                <h4>❌ Erro na requisição</h4>
                <p>${error.message}</p>
            `;
            resultDiv.style.display = 'block';
        } else {
            alert(`❌ Erro: ${error.message}`);
        }
    } finally {
        // Esconder loading
        if (loadingSpan) {
            loadingSpan.style.display = 'none';
        }
    }
}

    // Resto das funções permanecem iguais...
    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        if (!file.name.endsWith('.csv')) {
            this.showError('Apenas arquivos CSV são permitidos');
            return;
        }

        const uploadBox = document.getElementById('uploadBox');
        if (uploadBox) {
            uploadBox.innerHTML = `
                <div class="upload-icon">✅</div>
                <p>Arquivo selecionado: ${file.name}</p>
                <p>Tamanho: ${(file.size / 1024).toFixed(2)} KB</p>
            `;
        }

        const btnProcessar = document.getElementById('processarMassaBtn');
        if (btnProcessar) {
            btnProcessar.disabled = false;
        }
    }

    clearUnitaryForm() {
        const itemIdInput = document.getElementById('itemId'); // CORRIGIDO
        const precoInput = document.getElementById('precoPromocional');
        const dataFimInput = document.getElementById('data_fim'); // CORRIGIDO
        const itemInfo = document.getElementById('item-info');

        if (itemIdInput) itemIdInput.value = '';
        if (precoInput) precoInput.value = '';
        if (dataFimInput) dataFimInput.value = '';
        if (itemInfo) itemInfo.style.display = 'none';
    }

    showLoading(show) {
        const modal = document.getElementById('loadingModal');
        if (modal) {
            modal.style.display = show ? 'block' : 'none';
        }
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }
}

// Função para alternar entre preço e percentual
function toggleDescontoFields() {
    const metodo = document.getElementById('metodoDesconto')?.value;
    const precoGroup = document.getElementById('precoPromocionalGroup');
    const percentualGroup = document.getElementById('percentualDescontoGroup');
    
    if (metodo === 'percentual') {
        if (precoGroup) precoGroup.style.display = 'none';
        if (percentualGroup) percentualGroup.style.display = 'block';
    } else {
        if (precoGroup) precoGroup.style.display = 'block';
        if (percentualGroup) percentualGroup.style.display = 'none';
    }
    
    // Re-aplicar auto-preenchimento se há campanha selecionada
    const campanhaSelect = document.getElementById('campanhaEspecifica');
    if (campanhaSelect && campanhaSelect.value) {
        mostrarDetalhesCampanha();
    }
}

// Função para mostrar/esconder campos baseado no tipo
function togglePromocaoFields() {
    const tipo = document.getElementById('tipoPromocao')?.value;
    const campanhaGroup = document.getElementById('campanhaEspecificaGroup');
    const filtroGroup = document.getElementById('filtroDescontoGroup');
    
    if (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN') {
        if (campanhaGroup) campanhaGroup.style.display = 'block';
        if (filtroGroup) filtroGroup.style.display = 'none';
    } else if (tipo === 'DEAL_AUTO') {
        if (campanhaGroup) campanhaGroup.style.display = 'none';
        if (filtroGroup) filtroGroup.style.display = 'block';
    } else {
        if (campanhaGroup) campanhaGroup.style.display = 'none';
        if (filtroGroup) filtroGroup.style.display = 'none';
    }
}

// Função auxiliar para mostrar resultados
function showResult(elementId, type, content) {
    const element = document.getElementById(elementId);
    if (element) {
        element.className = `result ${type}`;
        element.innerHTML = content;
        element.style.display = 'block';
    }
}

// Função auxiliar para limpar formulário
function clearFormulario() {
    const itemIdInput = document.getElementById('itemId');
    const precoInput = document.getElementById('precoPromocional');
    const dataFimInput = document.getElementById('data_fim');
    const itemInfo = document.getElementById('item-info');

    if (itemIdInput) itemIdInput.value = '';
    if (precoInput) precoInput.value = '';
    if (dataFimInput) dataFimInput.value = '';
    if (itemInfo) itemInfo.style.display = 'none';
}

// Função para debug - verificar elementos
function debugElementos() {
    console.log('🔍 === DEBUG COMPLETO DOS ELEMENTOS ===');
    
    const elementos = [
        'itemId',
        'precoPromocional', 
        'data_fim',
        'tipoPromocao',
        'campanhaEspecifica',
        'descontoMaximo',
        'resultado-promocao'
    ];
    
    elementos.forEach(id => {
        const elemento = document.getElementById(id);
        console.log(`${id}:`, elemento ? '✅ Encontrado' : '❌ NULL');
        if (elemento) {
            console.log(`  - Tipo: ${elemento.tagName}`);
            console.log(`  - Valor: "${elemento.value || elemento.innerHTML?.substring(0, 50) || 'vazio'}"`);
        }
    });
    
    console.log('🔍 === FIM DO DEBUG ===');
}

// Funções adicionais do HTML que podem estar faltando
async function consultarItem() {
    const itemId = document.getElementById('itemId')?.value?.trim();
    const resultDiv = document.getElementById('item-info');
    const loadingSpan = document.getElementById('consultar-loading');
    
    if (!itemId) {
        alert('Digite o ID do item');
        return;
    }
    
    if (loadingSpan) loadingSpan.style.display = 'inline-block';
    if (resultDiv) resultDiv.style.display = 'none';
    
    try {
        const response = await fetch(`/api/criar-promocao/item/${itemId}`);
        const data = await response.json();
        
        if (data.success) {
            const item = data.data.item;
            const resumo = data.data.resumo;
            
            // Salvar preço globalmente para uso posterior
            window.ultimoPrecoConsultado = parseFloat(item.price);
            
            let promocoesHtml = '';
            
            if (resumo.ativas && resumo.ativas.length > 0) {
                promocoesHtml += `
                    <div class="item-detail">
                        <span><strong>🎯 Participando Ativamente:</strong></span>
                        <span>${resumo.ativas.join(', ')}</span>
                    </div>
                `;
            }
            
            if (resumo.disponiveis && resumo.disponiveis.length > 0) {
                promocoesHtml += `
                    <div class="item-detail">
                        <span><strong>📋 Campanhas Disponíveis:</strong></span>
                        <span>${resumo.disponiveis.join(', ')}</span>
                    </div>
                `;
            }
            
            if (resumo.automaticas && resumo.automaticas.length > 0) {
                promocoesHtml += `
                    <div class="item-detail">
                        <span><strong>🤖 Promoções Automáticas:</strong></span>
                        <span>${resumo.automaticas.join(', ')}</span>
                    </div>
                `;
            }
            
            if (resultDiv) {
                resultDiv.innerHTML = `
                    <div class="item-info">
                        <h4>📋 Informações do Item</h4>
                        <div class="item-detail">
                            <span><strong>Título:</strong></span>
                            <span>${item.title}</span>
                        </div>
                        <div class="item-detail">
                            <span><strong>Preço Atual:</strong></span>
                            <span>R\$ ${item.price}</span>
                        </div>
                        <div class="item-detail">
                            <span><strong>Status:</strong></span>
                            <span class="status-badge ${item.status === 'active' ? 'success' : 'error'}">${item.status}</span>
                        </div>
                        <div class="item-detail">
                            <span><strong>Categoria:</strong></span>
                            <span>${item.category_id || 'N/A'}</span>
                        </div>
                        <div class="item-detail">
                            <span><strong>Vendas:</strong></span>
                            <span>${item.sold_quantity || 0}</span>
                        </div>
                        <div class="item-detail">
                            <span><strong>Pode Criar Promoção:</strong></span>
                            <span class="status-badge ${data.data.pode_criar_promocao ? 'success' : 'error'}">
                                ${data.data.pode_criar_promocao ? 'Sim' : 'Não'}
                            </span>
                        </div>
                        ${promocoesHtml}
                    </div>
                `;
                resultDiv.style.display = 'block';
            }
            
            // Sugerir preço promocional (10% de desconto)
            const precoSugerido = (item.price * 0.9).toFixed(2);
            const precoInput = document.getElementById('precoPromocional');
            if (precoInput) {
                precoInput.value = precoSugerido;
            }
        } else {
            showResult('item-info', 'error', data.message);
        }
    } catch (error) {
        showResult('item-info', 'error', `Erro: ${error.message}`);
    } finally {
        if (loadingSpan) loadingSpan.style.display = 'none';
    }
}

// Criar instância global para ser acessada pelas funções do HTML
let criarPromocaoManager;

// Inicializar quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM carregado, iniciando CriarPromocaoManager...');
    criarPromocaoManager = new CriarPromocaoManager();
    
    // Fazer a função disponível globalmente para o HTML
    window.criarPromocaoIndividual = () => {
        if (criarPromocaoManager) {
            criarPromocaoManager.criarPromocaoIndividual();
        }
    };
    
    console.log('✅ CriarPromocaoManager inicializado com sucesso!');
});

// Disponibilizar todas as funções globalmente para o HTML
window.carregarCampanhas = carregarCampanhas;
window.mostrarDetalhesCampanha = mostrarDetalhesCampanha;
window.toggleDescontoFields = toggleDescontoFields;
window.togglePromocaoFields = togglePromocaoFields;
window.showResult = showResult;
window.clearFormulario = clearFormulario;
window.debugElementos = debugElementos;
window.consultarItem = consultarItem;

console.log('🎯 Arquivo criar-promocao.js carregado completamente!');