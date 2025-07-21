const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

class CriarPromocaoService {
  
  // Consultar item com análise detalhada de promoções
  static async consultarItem(mlbId, access_token = null) {
    try {
      // Se não foi fornecido token, tentar renovar automaticamente
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🔍 Verificando anúncio ${mlbId}...`);

      // 1. Primeiro verificar se o anúncio existe e pertence ao usuário
      const itemResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
      
      if (itemResponse.status === 401) {
        console.log('🔄 Token inválido, tentando renovar...');
        access_token = await TokenService.renovarTokenSeNecessario();
        headers.Authorization = `Bearer ${access_token}`;
        
        const retryResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
        if (!retryResponse.ok) {
          throw new Error(`Erro ao buscar anúncio após renovação: ${retryResponse.status}`);
        }
        var itemData = await retryResponse.json();
      } else if (!itemResponse.ok) {
        throw new Error(`Erro ao buscar anúncio: ${itemResponse.status}`);
      } else {
        var itemData = await itemResponse.json();
      }
      
      const userResponse = await fetch(config.urls.users_me, { headers });
      const userData = await userResponse.json();
      
      if (itemData.seller_id !== userData.id) {
        throw new Error('Este anúncio não pertence à sua conta');
      }

      console.log(`✅ Anúncio encontrado: ${itemData.title}`);
      console.log(`💰 Preço atual: R\$ ${itemData.price}`);

      // 2. Consultar promoções do item de forma mais detalhada
      console.log(`🔍 Consultando promoções do item ${mlbId}...`);
      
      const promotionsResponse = await fetch(`${config.urls.seller_promotions}/items/${mlbId}?app_version=v2`, { headers });
      
      let promocoesDetalhadas = {
        participacoes_ativas: [],
        campanhas_disponiveis: [],
        promocoes_automaticas: []
      };
      
      if (promotionsResponse.ok) {
        const promotionsData = await promotionsResponse.json();
        console.log(`📋 Dados de promoções brutos:`, promotionsData);
        
        if (promotionsData && promotionsData.length > 0) {
          promotionsData.forEach(promo => {
            console.log(`   Analisando: ${promo.type} - Status: ${promo.status} - Participation: ${promo.participation_status || 'N/A'}`);
            
            // Classificar por tipo e status mais específico
            if (promo.participation_status === 'active' || 
                (promo.status === 'started' && promo.participating === true)) {
              // Item está realmente participando ativamente
              promocoesDetalhadas.participacoes_ativas.push(promo);
            } else if (promo.type === 'AUTOMATIC' || 
                       promo.automatic === true || 
                       promo.type === 'REVIEWS_WITH_PHOTO') {
              // Promoções automáticas (como Opiniões com foto)
              promocoesDetalhadas.promocoes_automaticas.push(promo);
            } else if (promo.status === 'started' || promo.status === 'active') {
              // Campanha disponível mas item não está participando ativamente
              promocoesDetalhadas.campanhas_disponiveis.push(promo);
            } else if (promo.status === 'pending') {
              // Pendente de aprovação
              promocoesDetalhadas.campanhas_disponiveis.push(promo);
            }
          });
        }
      }

      // 3. Verificar se realmente tem promoções ATIVAS (não apenas disponíveis)
      const temPromocaoRealmenteAtiva = promocoesDetalhadas.participacoes_ativas.length > 0;
      
      console.log(`🎯 Análise de promoções:`);
      console.log(`   Participações ativas: ${promocoesDetalhadas.participacoes_ativas.length}`);
      console.log(`   Campanhas disponíveis: ${promocoesDetalhadas.campanhas_disponiveis.length}`);
      console.log(`   Promoções automáticas: ${promocoesDetalhadas.promocoes_automaticas.length}`);

      return {
        success: true,
        item: itemData,
        promocoes_detalhadas: promocoesDetalhadas,
        tem_promocao_realmente_ativa: temPromocaoRealmenteAtiva,
        pode_criar_promocao: !temPromocaoRealmenteAtiva,
        resumo_promocoes: {
          ativas: promocoesDetalhadas.participacoes_ativas.map(p => `${p.type} - ${p.status} (participando)`),
          disponiveis: promocoesDetalhadas.campanhas_disponiveis.map(p => `${p.type} - ${p.status} (disponível)`),
          automaticas: promocoesDetalhadas.promocoes_automaticas.map(p => `${p.type} - automática`)
        }
      };

    } catch (error) {
      console.error(`❌ Erro ao processar ${mlbId}:`, error.message);
      throw error;
    }
  }

  // Função para debugar campanha em detalhes
static async debugarCampanha(campanhaId, mlbId, access_token) {
  try {
    const headers = {
      "Authorization": `Bearer ${access_token}`,
      "Content-Type": "application/json"
    };

    console.log(`🔍 === DEBUG DETALHADO DA CAMPANHA ${campanhaId} ===`);
    
    // 1. Consultar detalhes da campanha (SEM app_version)
    try {
      const campanhaResponse = await fetch(`${config.urls.seller_promotions}/promotions/${campanhaId}`, { headers });
      
      if (campanhaResponse.ok) {
        const campanhaData = await campanhaResponse.json();
        console.log(`📋 Detalhes completos da campanha:`, JSON.stringify(campanhaData, null, 2));
        
        // Verificar datas
        if (campanhaData.start_date) {
          const inicioUTC = new Date(campanhaData.start_date);
          const agora = new Date();
          console.log(`⏰ Data início campanha: ${inicioUTC.toISOString()}`);
          console.log(`⏰ Data atual: ${agora.toISOString()}`);
          console.log(`⏰ Campanha já iniciou: ${agora >= inicioUTC ? '✅ SIM' : '❌ NÃO'}`);
          
          if (campanhaData.end_date) {
            const fimUTC = new Date(campanhaData.end_date);
            console.log(`⏰ Data fim campanha: ${fimUTC.toISOString()}`);
            console.log(`⏰ Campanha ainda válida: ${agora <= fimUTC ? '✅ SIM' : '❌ NÃO'}`);
          }
        }
        
        // Verificar participantes
        if (campanhaData.items && Array.isArray(campanhaData.items)) {
          console.log(`👥 Total de itens participando: ${campanhaData.items.length}`);
          const meuItem = campanhaData.items.find(item => item.id === mlbId);
          if (meuItem) {
            console.log(`✅ MEU ITEM ENCONTRADO NA CAMPANHA:`, meuItem);
          } else {
            console.log(`❌ Meu item NÃO encontrado na lista de participantes`);
            // Mostrar alguns exemplos de participantes
            if (campanhaData.items.length > 0) {
              console.log(`📋 Exemplos de participantes:`, campanhaData.items.slice(0, 3).map(item => item.id));
            }
          }
        }
        
        // Verificar status da campanha
        console.log(`📊 Status da campanha: ${campanhaData.status}`);
        console.log(`📊 Tipo da campanha: ${campanhaData.type}`);
        console.log(`📊 Nome da campanha: ${campanhaData.name || 'N/A'}`);
        
        // Verificar regras de participação
        if (campanhaData.participation_rules) {
          console.log(`📋 Regras de participação:`, campanhaData.participation_rules);
        }
        
      } else {
        console.log(`❌ Erro ao consultar campanha: ${campanhaResponse.status}`);
        const errorText = await campanhaResponse.text();
        console.log(`❌ Resposta de erro:`, errorText);
        
        // Tentar método alternativo
        console.log(`🔄 Tentando método alternativo para consultar campanha...`);
        
        try {
          const altResponse = await fetch(`${config.urls.seller_promotions}/promotions/${campanhaId}?app_version=v1`, { headers });
          if (altResponse.ok) {
            const altData = await altResponse.json();
            console.log(`✅ Método alternativo funcionou:`, altData);
          } else {
            console.log(`❌ Método alternativo também falhou: ${altResponse.status}`);
          }
        } catch (altError) {
          console.log(`❌ Erro no método alternativo:`, altError.message);
        }
      }
    } catch (error) {
      console.log(`❌ Erro ao debugar campanha:`, error.message);
    }
    
    // 2. Consultar todas as participações do usuário
    try {
      const userResponse = await fetch(config.urls.users_me, { headers });
      const userData = await userResponse.json();
      
      console.log(`👤 Consultando participações do usuário ${userData.id}...`);
      
      // Tentar diferentes endpoints de participações
      const participationEndpoints = [
        `${config.urls.seller_promotions}/users/${userData.id}/participations`,
        `${config.urls.seller_promotions}/users/${userData.id}/participations?app_version=v2`,
        `${config.urls.seller_promotions}/participations?user_id=${userData.id}`
      ];
      
      for (const endpoint of participationEndpoints) {
        try {
          console.log(`🔍 Tentando endpoint: ${endpoint}`);
          const participacoesResponse = await fetch(endpoint, { headers });
          
          if (participacoesResponse.ok) {
            const participacoes = await participacoesResponse.json();
            console.log(`✅ Participações encontradas:`, participacoes);
            
            // Procurar participação específica
            let minhaParticipacao = null;
            
            if (Array.isArray(participacoes)) {
              minhaParticipacao = participacoes.find(p => 
                p.promotion_id === campanhaId || 
                (p.items && p.items.some(item => item.id === mlbId))
              );
            } else if (participacoes.results && Array.isArray(participacoes.results)) {
              minhaParticipacao = participacoes.results.find(p => 
                p.promotion_id === campanhaId || 
                (p.items && p.items.some(item => item.id === mlbId))
              );
            }
            
            if (minhaParticipacao) {
              console.log(`✅ PARTICIPAÇÃO ENCONTRADA:`, minhaParticipacao);
            } else {
              console.log(`❌ Participação não encontrada nas minhas participações`);
            }
            
            break; // Se funcionou, não precisa tentar outros endpoints
          } else {
            console.log(`❌ Endpoint falhou: ${participacoesResponse.status}`);
          }
        } catch (endpointError) {
          console.log(`❌ Erro no endpoint ${endpoint}:`, endpointError.message);
        }
      }
      
    } catch (error) {
      console.log(`⚠️ Não foi possível consultar participações:`, error.message);
    }
    
    // 3. Verificar item específico na campanha
    try {
      console.log(`🔍 Verificando item ${mlbId} especificamente na campanha...`);
      
      const itemCampanhaEndpoints = [
        `${config.urls.seller_promotions}/promotions/${campanhaId}/items/${mlbId}`,
        `${config.urls.seller_promotions}/items/${mlbId}/promotions/${campanhaId}`,
        `${config.urls.seller_promotions}/items/${mlbId}/participation/${campanhaId}`
      ];
      
      for (const endpoint of itemCampanhaEndpoints) {
        try {
          console.log(`🔍 Tentando endpoint: ${endpoint}`);
          const itemResponse = await fetch(endpoint, { headers });
          
          if (itemResponse.ok) {
            const itemData = await itemResponse.json();
            console.log(`✅ Dados do item na campanha:`, itemData);
            break;
          } else {
            console.log(`❌ Endpoint falhou: ${itemResponse.status}`);
          }
        } catch (endpointError) {
          console.log(`❌ Erro no endpoint:`, endpointError.message);
        }
      }
      
    } catch (error) {
      console.log(`⚠️ Erro ao verificar item na campanha:`, error.message);
    }
    
    console.log(`🔍 === FIM DO DEBUG ===`);
    
  } catch (error) {
    console.log(`❌ Erro geral no debug:`, error.message);
  }
}

  // Função para tentar diferentes métodos de participação
  static async tentarMetodosAlternativos(mlbId, campanhaId, precoFinal, campanhaEscolhida, headers) {
    const resultados = [];
    
    // Método 1: Endpoint original (já tentamos)
    resultados.push({
      metodo: 'POST /promotions/{id}/items',
      status: 'já_tentado',
      resultado: 'resposta_vazia_mas_200'
    });
    
    // Método 2: Tentar com PUT em vez de POST
    try {
      console.log(`🔄 Tentativa 2: PUT /promotions/${campanhaId}/items`);
      
      const payload2 = {
        items: [{
          id: mlbId,
          price: precoFinal
        }]
      };
      
      const response2 = await fetch(`${config.urls.seller_promotions}/promotions/${campanhaId}/items`, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(payload2)
      });
      
      const text2 = await response2.text();
      console.log(`📡 Método 2 - Status: ${response2.status}, Resposta: ${text2}`);
      
      resultados.push({
        metodo: 'PUT /promotions/{id}/items',
        status: response2.status,
        resultado: text2 || 'vazio',
        sucesso: response2.ok
      });
      
      // ✅ CORREÇÃO: Aceitar status 200 mesmo com resposta vazia
      if (response2.ok) {
        console.log(`✅ Método PUT teve sucesso - Status 200!`);
        return { 
          sucesso: true, 
          metodo: 'PUT /promotions/{id}/items', 
          resposta: text2 || 'Resposta vazia mas status 200 OK',
          status_code: response2.status
        };
      }
      
    } catch (error) {
      console.log(`❌ Método 2 falhou: ${error.message}`);
      resultados.push({
        metodo: 'PUT /promotions/{id}/items',
        status: 'erro',
        resultado: error.message
      });
    }
    
    // Método 3: Tentar endpoint de participação direta
    try {
      console.log(`🔄 Tentativa 3: POST /promotions/${campanhaId}/participate`);
      
      const payload3 = {
        item_id: mlbId,
        promotional_price: precoFinal
      };
      
      const response3 = await fetch(`${config.urls.seller_promotions}/promotions/${campanhaId}/participate`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload3)
      });
      
      const text3 = await response3.text();
      console.log(`📡 Método 3 - Status: ${response3.status}, Resposta: ${text3}`);
      
      resultados.push({
        metodo: 'POST /promotions/{id}/participate',
        status: response3.status,
        resultado: text3 || 'vazio',
        sucesso: response3.ok
      });
      
      if (response3.ok) {
        return { sucesso: true, metodo: 'participate', resposta: text3 };
      }
      
    } catch (error) {
      console.log(`❌ Método 3 falhou: ${error.message}`);
      resultados.push({
        metodo: 'POST /promotions/{id}/participate',
        status: 'erro',
        resultado: error.message
      });
    }
    
    // Método 4: Tentar endpoint de items com estrutura diferente
    try {
      console.log(`🔄 Tentativa 4: POST /items/${mlbId}/promotions`);
      
      const payload4 = {
        promotion_id: campanhaId,
        price: precoFinal
      };
      
      const response4 = await fetch(`${config.urls.seller_promotions}/items/${mlbId}/promotions`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload4)
      });
      
      const text4 = await response4.text();
      console.log(`📡 Método 4 - Status: ${response4.status}, Resposta: ${text4}`);
      
      resultados.push({
        metodo: 'POST /items/{id}/promotions',
        status: response4.status,
        resultado: text4 || 'vazio',
        sucesso: response4.ok
      });
      
      if (response4.ok) {
        return { sucesso: true, metodo: 'items_promotions', resposta: text4 };
      }
      
    } catch (error) {
      console.log(`❌ Método 4 falhou: ${error.message}`);
      resultados.push({
        metodo: 'POST /items/{id}/promotions',
        status: 'erro',
        resultado: error.message
      });
    }
    
    console.log(`📋 Resumo de todas as tentativas:`, resultados);
    
    // ✅ VERIFICAR SE ALGUM MÉTODO TEVE STATUS 200
    const metodoComSucesso = resultados.find(r => r.status === 200 || r.status === '200');
    
    if (metodoComSucesso) {
      console.log(`✅ Encontrado método com sucesso: ${metodoComSucesso.metodo}`);
      return {
        sucesso: true,
        metodo: metodoComSucesso.metodo,
        resposta: metodoComSucesso.resultado || 'Resposta vazia mas status 200 OK',
        status_code: metodoComSucesso.status,
        todos_metodos: resultados
      };
    }
    
    return { 
      sucesso: false, 
      metodos_tentados: resultados,
      message: 'Todos os métodos falharam - nenhum retornou status 200'
    };
  }

  // Criar desconto individual em um item
  static async criarPromocaoUnico(mlbId, dadosPromocao, access_token = null) {
    try {
      // Se não foi fornecido token, tentar renovar automaticamente
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }
      
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🔍 Verificando anúncio ${mlbId}...`);

      // 1. Usar a função de consulta melhorada
      const consultaResultado = await this.consultarItem(mlbId, access_token);
      
      if (!consultaResultado.success) {
        throw new Error('Erro ao consultar item');
      }

      const itemData = consultaResultado.item;
      const promocoesDetalhadas = consultaResultado.promocoes_detalhadas;

      console.log(`✅ Anúncio encontrado: ${itemData.title}`);
      console.log(`💰 Preço atual: R\$ ${itemData.price}`);

      // 2. Verificar se realmente tem promoções ativas (não apenas disponíveis)
      if (!consultaResultado.pode_criar_promocao) {
        console.log(`⚠️ Item possui ${promocoesDetalhadas.participacoes_ativas.length} participação(ões) ativa(s)`);
        return {
          success: false,
          message: 'Item já está participando ativamente de promoções. Remova primeiro as participações ativas.',
          mlb_id: mlbId,
          titulo: itemData.title,
          preco_atual: itemData.price,
          promocoes_ativas: promocoesDetalhadas.participacoes_ativas.map(p => `${p.type} - ${p.status}`),
          campanhas_disponiveis: promocoesDetalhadas.campanhas_disponiveis.map(p => `${p.type} - ${p.status}`),
          ja_tinha_promocao: true
        };
      }

      // 3. Validar dados da promoção
      console.log(`📦 Dados recebidos no service:`, JSON.stringify(dadosPromocao, null, 2));

      const { tipo, preco_promocional, data_inicio, data_fim, percentual_desconto, campanha_id, desconto_maximo } = dadosPromocao;

      console.log(`🔍 Dados extraídos:`);
      console.log(`   - tipo: ${tipo}`);
      console.log(`   - campanha_id: ${campanha_id}`);
      console.log(`   - preco_promocional: ${preco_promocional}`);
      console.log(`   - percentual_desconto: ${percentual_desconto}`);
      console.log(`   - desconto_maximo: ${desconto_maximo}`);
      
      if (!tipo) {
        throw new Error('Tipo de promoção é obrigatório');
      }

      // Validar preço promocional
      let precoFinal;
      if (preco_promocional) {
        precoFinal = parseFloat(preco_promocional);
        if (precoFinal >= itemData.price) {
          throw new Error('Preço promocional deve ser menor que o preço atual');
        }
      } else if (percentual_desconto) {
        const desconto = parseFloat(percentual_desconto);
        if (desconto <= 0 || desconto >= 100) {
          throw new Error('Percentual de desconto deve estar entre 0 e 100');
        }
        precoFinal = itemData.price * (1 - desconto / 100);
      } else {
        throw new Error('Informe o preço promocional ou percentual de desconto');
      }

      console.log(`🎯 Criando promoção tipo: ${tipo}`);
      console.log(`💰 Preço atual: R\$ ${itemData.price}`);
      console.log(`🏷️ Preço promocional: R\$ ${precoFinal.toFixed(2)}`);

      let resultadoCriacao = {
        metodos_tentados: [],
        sucesso: false,
        promocao_criada: null,
        detalhes: {},
        campanha_escolhida: null,
        desconto_aplicado: null,
        campanhas_filtradas: []
      };

      // Obter dados do usuário
      const userResponse = await fetch(config.urls.users_me, { headers });
      const userData = await userResponse.json();

      // 4. Criar promoção baseada no tipo
      try {
        if (tipo === 'DEAL_AUTO') {
          // Modo automático com filtro de desconto
          console.log(`🤖 Modo automático - buscando melhor campanha...`);
          
          const campanhasDeal = promocoesDetalhadas.campanhas_disponiveis.filter(c => c.type === 'DEAL');
          
          if (campanhasDeal.length === 0) {
            throw new Error('Nenhuma campanha DEAL disponível no momento');
          }
          
          console.log(`📋 Campanhas DEAL encontradas: ${campanhasDeal.length}`);
          
          // Filtrar por desconto máximo se especificado
          let campanhasFiltradas = campanhasDeal;
          if (desconto_maximo && desconto_maximo > 0) {
            console.log(`🎯 Aplicando filtro: desconto ≤ ${desconto_maximo}%`);
            
            campanhasFiltradas = campanhasDeal.filter(campanha => {
              // Calcular desconto da campanha baseado no preço sugerido
              const descontoCampanha = ((itemData.price - precoFinal) / itemData.price) * 100;
              
              resultadoCriacao.campanhas_filtradas.push(
                `${campanha.name || campanha.id} - Desconto calculado: ${descontoCampanha.toFixed(1)}% ${descontoCampanha <= desconto_maximo ? '✅' : '❌'}`
              );
              
              return descontoCampanha <= desconto_maximo;
            });
            
            if (campanhasFiltradas.length === 0) {
              throw new Error(`Nenhuma campanha atende ao critério de desconto ≤ ${desconto_maximo}%. Campanhas analisadas: ${resultadoCriacao.campanhas_filtradas.join(', ')}`);
            }
            
            console.log(`✅ Campanhas que atendem ao filtro: ${campanhasFiltradas.length}`);
          }
          
          // Escolher a melhor campanha (primeira por enquanto, pode implementar lógica mais sofisticada)
          const melhorCampanha = campanhasFiltradas[0];
          console.log(`🎯 Campanha escolhida: ${melhorCampanha.name || melhorCampanha.id}`);
          
          const payload = {
            items: [{
              id: mlbId,
              price: precoFinal
            }]
          };
          
          console.log(`📦 Payload DEAL automático:`, payload);
          
          const participateResponse = await fetch(`${config.urls.seller_promotions}/promotions/${melhorCampanha.id}/items`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
          });
          
          if (participateResponse.ok) {
            const participateResult = await participateResponse.json();
            console.log(`✅ Participação automática criada:`, participateResult);
            
            const descontoCalculado = ((itemData.price - precoFinal) / itemData.price) * 100;
            
            resultadoCriacao.sucesso = true;
            resultadoCriacao.promocao_criada = 'DEAL_AUTO';
            resultadoCriacao.campanha_escolhida = melhorCampanha.name || melhorCampanha.id;
            resultadoCriacao.desconto_aplicado = descontoCalculado.toFixed(1);
            resultadoCriacao.detalhes = participateResult;
            resultadoCriacao.metodos_tentados.push(`✅ DEAL_AUTO - Participação automática criada na campanha: ${melhorCampanha.name || melhorCampanha.id}`);
            
            if (desconto_maximo) {
              resultadoCriacao.metodos_tentados.push(`🎯 Filtro aplicado: desconto ${descontoCalculado.toFixed(1)}% ≤ ${desconto_maximo}% ✅`);
            }
          } else {
            const errorData = await participateResponse.json().catch(() => ({}));
            console.error(`❌ Erro DEAL automático:`, errorData);
            throw new Error(`Erro ao participar automaticamente: ${errorData.message || participateResponse.status}`);
          }

        } else if (tipo === 'DEAL_MANUAL' || tipo === 'SELLER_CAMPAIGN') {
          // Modo manual - usar campanha específica
          console.log(`🎯 Modo manual - usando campanha específica: ${campanha_id}`);
          
          if (!campanha_id) {
            throw new Error('ID da campanha é obrigatório para modo manual');
          }
          
          // Buscar detalhes da campanha escolhida
          const campanhasDisponiveis = [...promocoesDetalhadas.campanhas_disponiveis];
          let campanhaEscolhida = campanhasDisponiveis.find(c => c.id === campanha_id);
          
          if (!campanhaEscolhida) {
            console.log(`🔍 Campanha não encontrada nas disponíveis do item, buscando nas campanhas gerais...`);
            
            const campaignsResponse = await fetch(`${config.urls.seller_promotions}/users/${userData.id}?app_version=v2`, { headers });
            
            if (campaignsResponse.ok) {
              const campaignsData = await campaignsResponse.json();
              const todasCampanhas = Array.isArray(campaignsData) ? campaignsData : (campaignsData.results || []);
              campanhaEscolhida = todasCampanhas.find(c => c.id === campanha_id);
            }
          }
          
          if (!campanhaEscolhida) {
            throw new Error(`Campanha ${campanha_id} não encontrada ou não disponível`);
          }
          
          console.log(`🎯 Usando campanha: ${campanhaEscolhida.name || campanhaEscolhida.id} (${campanhaEscolhida.type})`);
          
          // VERIFICAR PERÍODO DA CAMPANHA
          let dataInicioFinal;
          let dataFimFinal;

          if (campanhaEscolhida.start_date && campanhaEscolhida.end_date) {
            const inicioCampanha = new Date(campanhaEscolhida.start_date);
            const fimCampanha = new Date(campanhaEscolhida.end_date);
            const agora = new Date();
            
            console.log(`📅 Período da campanha:`);
            console.log(`   Início: ${inicioCampanha.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);
            console.log(`   Fim: ${fimCampanha.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);
            console.log(`   Agora: ${agora.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);
            
            const dataAtual = new Date();
            dataInicioFinal = dataAtual.toISOString();
            
            if (agora < inicioCampanha) {
              console.log(`⚠️ Atenção: Campanha ainda não iniciou.`);
            } else if (agora > fimCampanha) {
              throw new Error(`Campanha já expirou em ${fimCampanha.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);
            } else {
              console.log(`✅ Campanha está ativa.`);
            }
            
            if (data_fim && data_fim.trim() !== '') {
              const dataFimUsuario = new Date(data_fim);
              if (dataFimUsuario > fimCampanha) {
                dataFimFinal = campanhaEscolhida.end_date;
              } else {
                dataFimFinal = data_fim;
              }
            } else {
              dataFimFinal = campanhaEscolhida.end_date;
            }
            
          } else {
            const dataAtual = new Date();
            dataInicioFinal = dataAtual.toISOString();

            if (data_fim && data_fim.trim() !== '') {
              dataFimFinal = data_fim;
            } else {
              const dataFimPadrao = new Date();
              dataFimPadrao.setDate(dataFimPadrao.getDate() + 30);
              dataFimFinal = dataFimPadrao.toISOString();
            }
          }

          console.log(`📅 Datas finais configuradas:`);
          console.log(`   ⏰ Início: ${new Date(dataInicioFinal).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);
          console.log(`   🏁 Fim: ${new Date(dataFimFinal).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`);

          const descontoCalculado = ((itemData.price - precoFinal) / itemData.price) * 100;
          console.log(`📊 Desconto calculado: ${descontoCalculado.toFixed(1)}%`);

          // ✅ TENTAR DESCONTO DIRETO PRIMEIRO
          try {
            console.log(`🎯 Tentando desconto direto (SALE_PRICE) primeiro...`);
            
            const payloadDesconto = {
              price: precoFinal,
              start_time: dataInicioFinal,
              end_time: dataFimFinal
            };
            
            console.log(`📦 Payload desconto direto:`, JSON.stringify(payloadDesconto, null, 2));
            
            const responseDesconto = await fetch(`https://api.mercadolibre.com/items/${mlbId}/sale_price`, {
              method: 'PUT',
              headers: headers,
              body: JSON.stringify(payloadDesconto)
            });
            
            const responseTextDesconto = await responseDesconto.text();
            console.log(`📡 Resposta desconto direto - Status: ${responseDesconto.status}, Resposta: ${responseTextDesconto}`);
            
            if (responseDesconto.ok) {
              console.log(`✅ Desconto direto aplicado com sucesso!`);
              
              resultadoCriacao.sucesso = true;
              resultadoCriacao.promocao_criada = 'SALE_PRICE';
              resultadoCriacao.campanha_escolhida = 'Desconto Direto no Item (SALE_PRICE)';
              resultadoCriacao.desconto_aplicado = descontoCalculado.toFixed(1);
              resultadoCriacao.detalhes = { 
                metodo: 'SALE_PRICE direto',
                resposta: responseTextDesconto || 'Resposta vazia mas status 200 OK',
                payload_usado: payloadDesconto
              };
              resultadoCriacao.metodos_tentados.push(`✅ SALE_PRICE - Desconto direto aplicado com sucesso`);
              resultadoCriacao.metodos_tentados.push(`📊 Desconto aplicado: ${descontoCalculado.toFixed(1)}%`);
              resultadoCriacao.metodos_tentados.push(`💰 Preço: R\$ ${itemData.price} → R\$ ${precoFinal}`);
              resultadoCriacao.metodos_tentados.push(`📅 Período: ${new Date(dataInicioFinal).toLocaleString('pt-BR')} até ${new Date(dataFimFinal).toLocaleString('pt-BR')}`);
              
            } else {
              console.log(`❌ Desconto direto falhou, tentando campanha como fallback...`);
              
              // FALLBACK: Tentar método da campanha
              const payload = {
                items: [{
                  id: mlbId,
                  price: precoFinal,
                  start_time: dataInicioFinal,
                  end_time: dataFimFinal
                }]
              };
              
              const participateResponse = await fetch(`${config.urls.seller_promotions}/promotions/${campanha_id}/items`, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(payload)
              });
              
              const responseText = await participateResponse.text();
              console.log(`📡 Resposta PUT campanha (fallback) - Status: ${participateResponse.status}, Resposta: ${responseText}`);
              
              if (participateResponse.ok) {
                console.log(`✅ Sucesso com campanha (fallback)!`);
                
                resultadoCriacao.sucesso = true;
                resultadoCriacao.promocao_criada = tipo;
                resultadoCriacao.campanha_escolhida = campanhaEscolhida.name || campanhaEscolhida.id;
                resultadoCriacao.desconto_aplicado = descontoCalculado.toFixed(1);
                resultadoCriacao.detalhes = { 
                  metodo: 'PUT campanha (fallback)',
                  resposta: responseText || 'Resposta vazia mas status 200 OK',
                  payload_usado: payload
                };
                resultadoCriacao.metodos_tentados.push(`✅ ${tipo} - Sucesso com campanha (fallback)`);
                
              } else {
                throw new Error(`Falha em todos os métodos. Desconto direto: ${responseTextDesconto}, Campanha: ${responseText}`);
              }
            }
            
          } catch (error) {
            console.error(`❌ Erro na participação:`, error.message);
            throw new Error(`Erro ao participar da campanha: ${error.message}`);
          }

        } else {
          // ✅ AQUI: Fora do bloco DEAL_MANUAL
          throw new Error(`Tipo de promoção '${tipo}' não suportado. Use: DEAL_AUTO, DEAL_MANUAL ou SELLER_CAMPAIGN`);
        }

        // 5. Verificar resultado final com múltiplas tentativas
        console.log(`⏳ Aguardando para verificar resultado...`);

        let promocaoAplicada = false;
        let tentativasVerificacao = 0;
        const maxTentativas = 3;
        const intervalos = [5000, 10000, 15000]; // 5s, 10s, 15s

        for (let i = 0; i < maxTentativas; i++) {
          tentativasVerificacao++;
          console.log(`🔍 Verificação ${tentativasVerificacao}/${maxTentativas} - Aguardando ${intervalos[i]/1000}s...`);
          
          await new Promise(resolve => setTimeout(resolve, intervalos[i]));
          
          // Verificar se a promoção foi aplicada
          const verificacaoConsulta = await this.consultarItem(mlbId, access_token);
          
          // Verificar também o item atualizado
          const itemVerificacaoResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
          const itemVerificacaoData = await itemVerificacaoResponse.json();

          console.log(`🎯 Verificação ${tentativasVerificacao}:`);
          console.log(`   Participações ativas: ${verificacaoConsulta.promocoes_detalhadas.participacoes_ativas.length}`);
          console.log(`   Preço antes: ${itemData.price}`);
          console.log(`   Preço depois: ${itemVerificacaoData.price}`);
          console.log(`   Original antes: ${itemData.original_price || 'N/A'}`);
          console.log(`   Original depois: ${itemVerificacaoData.original_price || 'N/A'}`);
          
          // Verificar múltiplos indicadores de sucesso
          const temParticipacaoAtiva = verificacaoConsulta.promocoes_detalhadas.participacoes_ativas.length > 0;
          const precoMudou = itemVerificacaoData.price !== itemData.price;
          const originalPrecoMudou = itemVerificacaoData.original_price !== itemData.original_price;
          const temOriginalPrice = itemVerificacaoData.original_price && itemVerificacaoData.original_price > itemVerificacaoData.price;
          
          promocaoAplicada = temParticipacaoAtiva || precoMudou || originalPrecoMudou || temOriginalPrice;
          
          if (promocaoAplicada) {
            console.log(`✅ Promoção detectada na verificação ${tentativasVerificacao}!`);
            break;
          } else {
            console.log(`⏳ Promoção ainda não detectada na verificação ${tentativasVerificacao}...`);
            
            // Na última tentativa, verificar campanhas específicas
            if (i === maxTentativas - 1) {
              console.log(`🔍 Verificação final - consultando campanha específica...`);
              
              // ADICIONAR DEBUG DETALHADO
              await this.debugarCampanha(campanha_id, mlbId, access_token);
              
              try {
                // Tentar consultar a campanha diretamente
                const campanhaResponse = await fetch(`${config.urls.seller_promotions}/promotions/${campanha_id}`, { headers });
                
                if (campanhaResponse.ok) {
                  const campanhaData = await campanhaResponse.json();
                  console.log(`📋 Status da campanha:`, campanhaData);
                  
                  // Verificar se tem informações sobre participantes
                  if (campanhaData.items && Array.isArray(campanhaData.items)) {
                    const itemNaCampanha = campanhaData.items.find(item => item.id === mlbId);
                    if (itemNaCampanha) {
                      console.log(`✅ Item encontrado na campanha:`, itemNaCampanha);
                      promocaoAplicada = true;
                    }
                  }
                }
              } catch (error) {
                console.log(`⚠️ Não foi possível consultar campanha diretamente:`, error.message);
              }
            }
          }
        }

        // Resultado final mais detalhado
        const verificacaoFinal = await this.consultarItem(mlbId, access_token);
        const itemFinal = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
        const itemFinalData = await itemFinal.json();

        return {
          success: resultadoCriacao.sucesso,
          message: resultadoCriacao.sucesso ? 
            (promocaoAplicada ? 'Promoção criada e aplicada com sucesso!' : 'Promoção criada com sucesso - pode demorar para aparecer') : 
            'Erro ao criar promoção',
          mlb_id: mlbId,
          titulo: itemData.title,
          preco_antes: itemData.price,
          preco_depois: itemFinalData.price,
          preco_original_antes: itemData.original_price,
          preco_original_depois: itemFinalData.original_price,
          promocao_aplicada: promocaoAplicada,
          promocao_aceita_pela_api: resultadoCriacao.sucesso,
          tipo_promocao: resultadoCriacao.promocao_criada,
          campanha_escolhida: resultadoCriacao.campanha_escolhida,
          desconto_aplicado: resultadoCriacao.desconto_aplicado,
          metodos_tentados: resultadoCriacao.metodos_tentados,
          promocoes_criadas: verificacaoFinal.resumo_promocoes.ativas,
          detalhes_promocao: resultadoCriacao.detalhes,
          campanhas_filtradas: resultadoCriacao.campanhas_filtradas,
          ja_tinha_promocao: false,
          verificacoes_realizadas: tentativasVerificacao,
          debug_info: {
            participacoes_ativas_final: verificacaoFinal.promocoes_detalhadas.participacoes_ativas.length,
            campanhas_disponiveis_final: verificacaoFinal.promocoes_detalhadas.campanhas_disponiveis.length,
            preco_mudou: itemFinalData.price !== itemData.price,
            original_price_mudou: itemFinalData.original_price !== itemData.original_price,
            tem_original_price: !!itemFinalData.original_price
          }
        };

      } catch (error) {
        // ✅ CATCH PRINCIPAL DA FUNÇÃO criarPromocaoUnico
                console.error(`❌ Erro ao criar promoção ${tipo}:`, error.message);
        resultadoCriacao.metodos_tentados.push(`❌ ${tipo} - Erro: ${error.message}`);
        
        return {
          success: false,
          message: error.message,
          mlb_id: mlbId,
          error: true,
          metodos_tentados: resultadoCriacao.metodos_tentados
        };
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${mlbId}:`, error.message);
      return {
        success: false,
        message: error.message,
        mlb_id: mlbId,
        error: true
      };
    }
  } // <-- FECHA a função criarPromocaoUnico

  // Função para criar desconto direto no item (PRICE_DISCOUNT)
  static async criarDescontoDireto(mlbId, precoPromocional, dataFim = null, access_token = null) {
    try {
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🎯 Tentando criar desconto direto (SALE_PRICE) para ${mlbId}...`);
      
      const dataInicio = new Date();
      const dataFimFinal = dataFim ? new Date(dataFim) : new Date(dataInicio.getTime() + (30 * 24 * 60 * 60 * 1000));
      
      const payload = {
        price: parseFloat(precoPromocional),
        start_time: dataInicio.toISOString(),
        end_time: dataFimFinal.toISOString()
      };
      
      console.log(`📦 Payload desconto direto:`, JSON.stringify(payload, null, 2));
      
      const response = await fetch(`https://api.mercadolibre.com/items/${mlbId}/sale_price`, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(payload)
      });
      
      const responseText = await response.text();
      console.log(`📡 Resposta desconto direto - Status: ${response.status}, Resposta: ${responseText}`);
      
      if (response.ok) {
        console.log(`✅ Desconto direto criado com sucesso!`);
        return { 
          success: true, 
          method: 'SALE_PRICE',
          response: responseText || 'Resposta vazia mas status 200 OK',
          payload_usado: payload
        };
      } else {
        console.log(`❌ Erro no desconto direto: ${responseText}`);
        return { success: false, error: responseText, status: response.status };
      }
      
    } catch (error) {
      console.error(`❌ Erro ao criar desconto direto:`, error);
      return { success: false, error: error.message };
    }
  }

  // Processar criação em lote (baseado no seu processarRemocaoLote)
  static async processarCriacaoLote(processId, itensPromocao, delay, processamentosCriacao) {
    const status = processamentosCriacao[processId];
    status.status = 'processando';
    
    console.log(`🚀 Iniciando criação em lote: ${itensPromocao.length} promoções`);

    for (let i = 0; i < itensPromocao.length; i++) {
      const item = itensPromocao[i];
      
      if (!item.mlb_id) continue;

      try {
        console.log(`📋 Processando ${i + 1}/${itensPromocao.length}: ${item.mlb_id}`);
        
        const resultado = await this.criarPromocaoUnico(item.mlb_id, item);
        
        status.resultados.push(resultado);
        
        if (resultado.success) {
          status.sucessos++;
        } else {
          status.erros++;
        }
        
      } catch (error) {
        console.error(`❌ Erro ao processar ${item.mlb_id}:`, error.message);
        status.erros++;
        status.resultados.push({
          success: false,
          mlb_id: item.mlb_id,
          message: error.message,
          error: true
        });
      }
      
      status.processados++;
      status.progresso = Math.round((status.processados / status.total_anuncios) * 100);
      
      // Delay entre processamentos (exceto no último)
      if (i < itensPromocao.length - 1) {
        console.log(`⏳ Aguardando ${delay}ms antes do próximo...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    status.status = 'concluido';
    status.concluido_em = new Date();
    
    console.log(`✅ Processamento concluído: ${status.sucessos} sucessos, ${status.erros} erros`);
  }

  // Função alternativa para participar de campanha (método direto)
  static async participarCampanhaAlternativo(mlbId, campanhaId, precoFinal, access_token) {
    try {
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "MercadoLibre-Seller-App"
      };

      console.log(`🔄 Tentativa alternativa - Participar campanha ${campanhaId}`);
      
      // Método 1: Tentar com endpoint simplificado
      const payload1 = {
        item_id: mlbId,
        price: precoFinal
      };
      
      console.log(`📦 Payload alternativo 1:`, payload1);
      
      const response1 = await fetch(`${config.urls.seller_promotions}/promotions/${campanhaId}/participate`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload1)
      });
      
      console.log(`📡 Resposta alternativa 1: ${response1.status}`);
      
      if (response1.ok) {
        const text1 = await response1.text();
        console.log(`✅ Sucesso método alternativo 1:`, text1);
        return { success: true, method: 'alternativo_1', response: text1 };
      }
      
      // Método 2: Tentar com estrutura diferente
      const payload2 = {
        promotion_id: campanhaId,
        items: [{
          item_id: mlbId,
          promotional_price: precoFinal
        }]
      };
      
      console.log(`📦 Payload alternativo 2:`, payload2);
      
      const response2 = await fetch(`${config.urls.seller_promotions}/participate`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload2)
      });
      
      console.log(`📡 Resposta alternativa 2: ${response2.status}`);
      
      if (response2.ok) {
        const text2 = await response2.text();
        console.log(`✅ Sucesso método alternativo 2:`, text2);
        return { success: true, method: 'alternativo_2', response: text2 };
      }
      
      return { success: false, message: 'Todos os métodos alternativos falharam' };
      
    } catch (error) {
      console.error(`❌ Erro nos métodos alternativos:`, error);
      return { success: false, message: error.message };
    }
  }

  // Consultar promoções disponíveis para o usuário
  static async consultarPromocoesDisponiveis(access_token = null) {
    try {
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      // Obter dados do usuário
      const userResponse = await fetch(config.urls.users_me, { headers });
      
      if (!userResponse.ok) {
        throw new Error(`Erro ao obter dados do usuário: ${userResponse.status}`);
      }
      
      const userData = await userResponse.json();
      console.log(`👤 Usuário: ${userData.id} - ${userData.nickname}`);

      // Consultar campanhas disponíveis
      console.log(`🔍 Consultando campanhas para usuário ${userData.id}...`);
      const campaignsResponse = await fetch(`${config.urls.seller_promotions}/users/${userData.id}?app_version=v2`, { headers });
      
      if (!campaignsResponse.ok) {
        throw new Error(`Erro ao consultar campanhas: ${campaignsResponse.status} - ${campaignsResponse.statusText}`);
      }

      const campaignsData = await campaignsResponse.json();
      console.log(`📋 Resposta bruta da API:`, campaignsData);
      
      // Verificar se a resposta é um array ou objeto
      let campanhas = [];
      
      if (Array.isArray(campaignsData)) {
        campanhas = campaignsData;
      } else if (campaignsData && campaignsData.results && Array.isArray(campaignsData.results)) {
        campanhas = campaignsData.results;
      } else if (campaignsData && campaignsData.promotions && Array.isArray(campaignsData.promotions)) {
        campanhas = campaignsData.promotions;
      } else {
        console.warn('⚠️ Estrutura de resposta inesperada:', campaignsData);
        // Se não conseguir identificar a estrutura, retornar dados brutos para debug
        return {
          success: true,
          user_id: userData.id,
          campanhas_disponiveis: [],
          campanhas_ativas: [],
          total_campanhas: 0,
          resposta_bruta: campaignsData,
          debug_info: 'Estrutura de resposta não reconhecida - verifique resposta_bruta'
        };
      }
      
      console.log(`📊 Total de campanhas encontradas: ${campanhas.length}`);

      // Filtrar campanhas ativas
      const campanhasAtivas = campanhas.filter(campaign => {
        const isActive = campaign.status === 'active' || campaign.status === 'started';
        const notExpired = !campaign.end_date || new Date(campaign.end_date) > new Date();
        return isActive && notExpired;
      });
      
      console.log(`✅ Campanhas ativas: ${campanhasAtivas.length}`);
      
      return {
        success: true,
        user_id: userData.id,
        campanhas_disponiveis: campanhas,
        campanhas_ativas: campanhasAtivas,
        total_campanhas: campanhas.length,
        debug_info: {
          estrutura_resposta: Array.isArray(campaignsData) ? 'array' : 'objeto',
          campos_disponiveis: campanhas.length > 0 ? Object.keys(campanhas[0]) : [],
          tipos_campanha: [...new Set(campanhas.map(c => c.type).filter(Boolean))]
        }
      };

    } catch (error) {
      console.error('❌ Erro ao consultar promoções disponíveis:', error.message);
      return {
        success: false,
        message: error.message,
        error: true,
        debug_info: 'Erro na requisição - verifique logs do servidor'
      };
    }
  }

  // Consultar campanhas disponíveis para um item específico
  static async consultarCampanhasItem(mlbId, access_token = null) {
    try {
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🔍 Consultando campanhas disponíveis para o item ${mlbId}...`);

      // 1. Primeiro consultar o item para garantir que existe e pertence ao usuário
      const consultaItem = await this.consultarItem(mlbId, access_token);
      
      if (!consultaItem.success) {
        throw new Error('Erro ao consultar item');
      }

      const itemData = consultaItem.item;
      const promocoesDetalhadas = consultaItem.promocoes_detalhadas;

      console.log(`✅ Item encontrado: ${itemData.title}`);
      console.log(`📋 Campanhas disponíveis para este item: ${promocoesDetalhadas.campanhas_disponiveis.length}`);

      // 2. Filtrar apenas campanhas que o item pode participar
      const campanhasElegiveis = promocoesDetalhadas.campanhas_disponiveis.filter(campanha => {
        // Filtrar por tipos que fazem sentido para participação manual
        const tiposPermitidos = ['DEAL', 'SMART', 'MARKETPLACE_CAMPAIGN', 'SELLER_CAMPAIGN'];
        return tiposPermitidos.includes(campanha.type);
      });

      console.log(`🎯 Campanhas elegíveis para participação: ${campanhasElegiveis.length}`);

      // 3. Enriquecer dados das campanhas com informações adicionais se necessário
      const campanhasEnriquecidas = await Promise.all(
        campanhasElegiveis.map(async (campanha) => {
          try {
            // Tentar obter mais detalhes da campanha se possível
            const detalhesResponse = await fetch(`${config.urls.seller_promotions}/promotions/${campanha.id}`, { 
              headers,
              method: 'GET'
            });
            
            if (detalhesResponse.ok) {
              const detalhes = await detalhesResponse.json();
              return {
                ...campanha,
                detalhes_adicionais: detalhes
              };
            }
          } catch (error) {
            console.log(`⚠️ Não foi possível obter detalhes da campanha ${campanha.id}:`, error.message);
          }
          
          return campanha;
        })
      );

      return {
        success: true,
        mlb_id: mlbId,
        item_titulo: itemData.title,
        item_preco: itemData.price,
        campanhas_item: campanhasEnriquecidas,
        total_campanhas_item: campanhasEnriquecidas.length,
        promocoes_ativas: promocoesDetalhadas.participacoes_ativas,
        pode_criar_promocao: consultaItem.pode_criar_promocao,
        resumo: {
          deal: campanhasEnriquecidas.filter(c => c.type === 'DEAL'),
          smart: campanhasEnriquecidas.filter(c => c.type === 'SMART'),
          marketplace: campanhasEnriquecidas.filter(c => c.type === 'MARKETPLACE_CAMPAIGN'),
          outros: campanhasEnriquecidas.filter(c => !['DEAL', 'SMART', 'MARKETPLACE_CAMPAIGN'].includes(c.type))
        }
      };

    } catch (error) {
      console.error(`❌ Erro ao consultar campanhas do item ${mlbId}:`, error.message);
      return {
        success: false,
        message: error.message,
        error: true
      };
    }
  }
}

module.exports = CriarPromocaoService;