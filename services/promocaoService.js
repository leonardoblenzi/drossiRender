const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

class PromocaoService {
  static async removerPromocaoUnico(mlbId, access_token = null) {
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

      // 2. Consultar promoções ativas do item usando API oficial
      console.log(`🔍 Consultando promoções do item ${mlbId}...`);
      
      const promotionsResponse = await fetch(`${config.urls.seller_promotions}/items/${mlbId}?app_version=v2`, { headers });
      
      if (!promotionsResponse.ok) {
        if (promotionsResponse.status === 404) {
          return {
            success: true,
            message: 'Item não possui promoções ativas',
            mlb_id: mlbId,
            titulo: itemData.title,
            preco_atual: itemData.price,
            tinha_promocao: false
          };
        }
        throw new Error(`Erro ao consultar promoções: ${promotionsResponse.status}`);
      }

      const promotionsData = await promotionsResponse.json();
      console.log(`📋 Promoções encontradas:`, promotionsData);

      if (!promotionsData || promotionsData.length === 0) {
        return {
          success: true,
          message: 'Item não possui promoções ativas',
          mlb_id: mlbId,
          titulo: itemData.title,
          preco_atual: itemData.price,
          tinha_promocao: false
        };
      }

      // 3. Identificar promoções ativas
      const promocoesAtivas = promotionsData.filter(promo => 
        promo.status === 'started' || promo.status === 'active' || promo.status === 'pending'
      );

      if (promocoesAtivas.length === 0) {
        return {
          success: true,
          message: 'Item não possui promoções ativas no momento',
          mlb_id: mlbId,
          titulo: itemData.title,
          preco_atual: itemData.price,
          tinha_promocao: false,
          promocoes_encontradas: promotionsData.map(p => `${p.type} - ${p.status}`)
        };
      }

      console.log(`🎯 Promoções ativas encontradas: ${promocoesAtivas.length}`);
      
      let resultadoRemocao = { 
        metodos_tentados: [], 
        sucesso: false,
        promocoes_removidas: [],
        promocoes_com_erro: []
      };

      // 4. Remover cada promoção usando o método correto
      for (const promocao of promocoesAtivas) {
        console.log(`🔄 Removendo promoção: ${promocao.type} (${promocao.id || 'sem ID'})`);
        
        try {
          let remocaoSucesso = false;
          
          // Usar o endpoint de delete massivo (mais eficiente)
          if (['DEAL', 'MARKETPLACE_CAMPAIGN', 'PRICE_DISCOUNT', 'VOLUME', 'PRE_NEGOTIATED', 'SELLER_CAMPAIGN', 'SMART', 'PRICE_MATCHING', 'UNHEALTHY_STOCK'].includes(promocao.type)) {
            
            console.log(`   Tentando remoção massiva para ${promocao.type}...`);
            
            const deleteResponse = await fetch(`${config.urls.seller_promotions}/items/${mlbId}?app_version=v2`, {
              method: 'DELETE',
              headers: headers
            });

            if (deleteResponse.ok) {
              const deleteResult = await deleteResponse.json();
              console.log(`   Resultado da remoção:`, deleteResult);
              
              if (deleteResult.successful_ids && deleteResult.successful_ids.length > 0) {
                remocaoSucesso = true;
                resultadoRemocao.promocoes_removidas.push(`${promocao.type} - Remoção massiva`);
                resultadoRemocao.metodos_tentados.push(`✅ ${promocao.type} - Remoção massiva SUCESSO`);
              }
              
              if (deleteResult.errors && deleteResult.errors.length > 0) {
                deleteResult.errors.forEach(error => {
                  resultadoRemocao.promocoes_com_erro.push(`${promocao.type} - ${error.error}`);
                  resultadoRemocao.metodos_tentados.push(`❌ ${promocao.type} - ${error.error}`);
                });
              }
            } else {
              const errorData = await deleteResponse.json().catch(() => ({}));
              resultadoRemocao.promocoes_com_erro.push(`${promocao.type} - Erro HTTP ${deleteResponse.status}`);
              resultadoRemocao.metodos_tentados.push(`❌ ${promocao.type} - Erro: ${errorData.message || deleteResponse.status}`);
            }
          }
          
          // Para DOD e LIGHTNING, tentar remoção individual se tiver ID da promoção
          else if (['DOD', 'LIGHTNING'].includes(promocao.type) && promocao.id) {
            console.log(`   Tentando remoção individual para ${promocao.type}...`);
            
            // Estes tipos precisam ser removidos individualmente
            // Consultar documentação específica para cada tipo
            resultadoRemocao.metodos_tentados.push(`⚠️ ${promocao.type} - Requer remoção individual (não implementado nesta versão)`);
          }
          
          if (remocaoSucesso) {
            resultadoRemocao.sucesso = true;
          }
          
        } catch (error) {
          console.error(`❌ Erro ao remover promoção ${promocao.type}:`, error.message);
          resultadoRemocao.promocoes_com_erro.push(`${promocao.type} - ${error.message}`);
          resultadoRemocao.metodos_tentados.push(`❌ ${promocao.type} - Erro: ${error.message}`);
        }
      }

      // 5. Verificar resultado final
      console.log(`⏳ Aguardando 3 segundos para verificar resultado...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verificar se ainda há promoções ativas
      const verificacaoResponse = await fetch(`${config.urls.seller_promotions}/items/${mlbId}?app_version=v2`, { headers });
      let promocoesRestantes = [];
      
      if (verificacaoResponse.ok) {
        const verificacaoData = await verificacaoResponse.json();
        promocoesRestantes = verificacaoData.filter(promo => 
          promo.status === 'started' || promo.status === 'active' || promo.status === 'pending'
        );
      }

      // Verificar também o item atualizado
      const itemVerificacaoResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
      const itemVerificacaoData = await itemVerificacaoResponse.json();

      const aindaTemPromocao = promocoesRestantes.length > 0;

      console.log(`🎯 Verificação final:`);
      console.log(`   Promoções restantes: ${promocoesRestantes.length}`);
      console.log(`   Preço antes: ${itemData.price}`);
      console.log(`   Preço depois: ${itemVerificacaoData.price}`);

      return {
        success: resultadoRemocao.sucesso || !aindaTemPromocao,
        message: resultadoRemocao.sucesso || !aindaTemPromocao ? 
          'Promoções processadas com sucesso' : 
          'Algumas promoções não puderam ser removidas',
        mlb_id: mlbId,
        titulo: itemData.title,
        preco_antes: itemData.price,
        preco_depois: itemVerificacaoData.price,
        preco_original_antes: itemData.original_price,
        preco_original_depois: itemVerificacaoData.original_price,
        tinha_promocao: true,
        ainda_tem_promocao: aindaTemPromocao,
        metodos_tentados: resultadoRemocao.metodos_tentados,
        promocoes_encontradas: promocoesAtivas.map(p => `${p.type} - ${p.status}`),
        promocoes_removidas: resultadoRemocao.promocoes_removidas,
        promocoes_com_erro: resultadoRemocao.promocoes_com_erro,
        promocoes_restantes: promocoesRestantes.map(p => `${p.type} - ${p.status}`)
      };

    } catch (error) {
      console.error(`❌ Erro ao processar ${mlbId}:`, error.message);
      return {
        success: false,
        message: error.message,
        mlb_id: mlbId,
        error: true
      };
    }
  }

  static async processarRemocaoLote(processId, mlbIds, delay, processamentosRemocao) {
    const status = processamentosRemocao[processId];
    status.status = 'processando';
    
    console.log(`🚀 Iniciando processamento em lote: ${mlbIds.length} anúncios`);

    for (let i = 0; i < mlbIds.length; i++) {
      const mlbId = mlbIds[i].trim();
      
      if (!mlbId) continue;

      try {
        console.log(`📋 Processando ${i + 1}/${mlbIds.length}: ${mlbId}`);
        
        const resultado = await this.removerPromocaoUnico(mlbId);
        
        status.resultados.push(resultado);
        
        if (resultado.success) {
          status.sucessos++;
        } else {
          status.erros++;
        }
        
      } catch (error) {
        console.error(`❌ Erro ao processar ${mlbId}:`, error.message);
        status.erros++;
        status.resultados.push({
          success: false,
          mlb_id: mlbId,
          message: error.message,
          error: true
        });
      }
      
      status.processados++;
      status.progresso = Math.round((status.processados / status.total_anuncios) * 100);
      
      // Delay entre processamentos (exceto no último)
      if (i < mlbIds.length - 1) {
        console.log(`⏳ Aguardando ${delay}ms antes do próximo...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    status.status = 'concluido';
    status.concluido_em = new Date();
    
    console.log(`✅ Processamento concluído: ${status.sucessos} sucessos, ${status.erros} erros`);
  }
}

module.exports = PromocaoService;