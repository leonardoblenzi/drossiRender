const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

class PesquisaDescricaoService {
  
  // Pesquisar texto nas descrições de uma lista de MLBs (VERSÃO HÍBRIDA CORRIGIDA)
  static async pesquisarTextoEmDescricoes(mlbIds, textoPesquisa, access_token = null) {
    try {
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🔍 Iniciando pesquisa HÍBRIDA CORRIGIDA de "${textoPesquisa}" em ${mlbIds.length} MLBs...`);

      const resultados = {
        texto_pesquisado: textoPesquisa,
        total_mlbs_pesquisados: mlbIds.length,
        mlbs_com_texto: [],
        mlbs_sem_texto: [],
        mlbs_com_erro: [],
        estatisticas_gerais: {
          total_ocorrencias: 0,
          densidade_media: 0,
          palavras_analisadas: 0
        },
        resumo: {
          encontrados: 0,
          nao_encontrados: 0,
          erros: 0
        }
      };

      // Obter dados do usuário para validação
      let userData = null;
      try {
        const userResponse = await fetch('https://api.mercadolibre.com/users/me', { headers });
        if (userResponse.ok) {
          userData = await userResponse.json();
          console.log(`👤 Usuário logado: ${userData.nickname} (ID: ${userData.id})`);
        }
      } catch (error) {
        console.log('⚠️ Não foi possível obter dados do usuário');
      }

      // Processar cada MLB
      for (let i = 0; i < mlbIds.length; i++) {
        const mlbId = mlbIds[i].trim();
        
        if (!mlbId) continue;

        try {
          console.log(`📋 Processando ${i + 1}/${mlbIds.length}: ${mlbId}`);
          
          // Consultar dados do item
          const itemResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
          
          if (!itemResponse.ok) {
            console.log(`❌ Erro ao consultar ${mlbId}: ${itemResponse.status}`);
            
            let motivo = 'Erro na API';
            let detalhes = null;
            
            if (itemResponse.status === 404) {
              motivo = 'Item não encontrado';
            } else if (itemResponse.status === 403) {
              motivo = 'Acesso negado - Item não pertence à sua conta ou política do ML';
              detalhes = 'Use apenas MLBs da sua própria conta. Verifique se o item existe e pertence a você.';
            } else if (itemResponse.status === 401) {
              motivo = 'Token inválido ou expirado';
            }
            
            resultados.mlbs_com_erro.push({
              mlb_id: mlbId,
              erro: `Erro HTTP ${itemResponse.status}`,
              motivo: motivo,
              detalhes: detalhes
            });
            resultados.resumo.erros++;
            continue;
          }

          const itemData = await itemResponse.json();
          
          // 🎯 IDENTIFICAR TIPO DE ANÚNCIO
          const ehCatalogo = !!itemData.catalog_product_id;
          const tipoAnuncio = ehCatalogo ? 'CATÁLOGO' : 'TRADICIONAL';
          
          console.log(`🏷️ DEBUG - Tipo de anúncio: ${tipoAnuncio}`);
          console.log(`🔍 DEBUG - Catalog ID: ${itemData.catalog_product_id || 'N/A'}`);
          console.log(`🔍 DEBUG - Tem descriptions: ${!!itemData.descriptions} (${itemData.descriptions?.length || 0})`);
          
          // Verificar se o item pertence ao usuário
          if (userData && itemData.seller_id !== userData.id) {
            console.log(`⚠️ Item ${mlbId} não pertence à sua conta (Seller: ${itemData.seller_id})`);
            resultados.mlbs_com_erro.push({
              mlb_id: mlbId,
              erro: 'Item não pertence à sua conta',
              motivo: 'Você só pode pesquisar em itens da sua própria conta',
              detalhes: `Este item pertence ao seller ${itemData.seller_id}, mas você é ${userData.id}`
            });
            resultados.resumo.erros++;
            continue;
          }

          // Extrair textos básicos
          const textosTitulo = itemData.title || '';
          const textosDescricao = itemData.description || '';
          const textosAtributos = this.extrairTextosAtributos(itemData.attributes || []);

          console.log(`🔍 DEBUG - Título: ${textosTitulo.length} chars`);
          console.log(`🔍 DEBUG - Descrição básica: ${textosDescricao.length} chars`);
          console.log(`🔍 DEBUG - Atributos: ${textosAtributos.length} chars`);

          // 🚀 ESTRATÉGIA HÍBRIDA CORRIGIDA: FETCH OBRIGATÓRIO PARA CATÁLOGO
          let descricaoCompleta = '';
          let fonteDados = 'nenhuma';

          if (ehCatalogo) {
            console.log(`📦 DEBUG - ANÚNCIO DE CATÁLOGO: Executando API + FETCH obrigatório`);
            
            // Para catálogo: Sempre executar AMBOS (API + FETCH)
            console.log(`🌐 DEBUG - Executando FETCH para capturar descrição rica...`);
            const descricaoFetch = await this.extrairDescricaoViaFetch(itemData.permalink);
            
            console.log(`📦 DEBUG - Executando API para dados estruturados...`);
            const descricaoAPI = await this.obterDescricaoCatalogo(itemData, headers);
            
            // Priorizar FETCH (tem descrição rica com "01 volume")
            if (descricaoFetch && descricaoFetch.length > 100) {
              descricaoCompleta = descricaoFetch;
              fonteDados = 'catalogo_fetch';
              console.log(`🎉 DEBUG - FETCH bem-sucedido! Usando descrição rica (${descricaoFetch.length} chars)`);
              
              // Verificar se contém texto procurado
              if (descricaoFetch.toLowerCase().includes(textoPesquisa.toLowerCase())) {
                console.log(`🎯 DEBUG - TEXTO ENCONTRADO NO FETCH! "${textoPesquisa}" detectado`);
              }
            } else if (descricaoAPI && descricaoAPI.length > 50) {
              descricaoCompleta = descricaoAPI;
              fonteDados = 'catalogo_api_fallback';
              console.log(`📦 DEBUG - FETCH falhou, usando API como fallback (${descricaoAPI.length} chars)`);
            } else {
              console.log(`❌ DEBUG - Nem FETCH nem API retornaram descrição válida para catálogo`);
            }
            
          } else {
            console.log(`📄 DEBUG - ANÚNCIO TRADICIONAL: Usando apenas API padrão`);
            
            // Para tradicional: Usar apenas API padrão
            descricaoCompleta = await this.obterDescricaoTradicional(mlbId, headers);
            if (descricaoCompleta) {
              fonteDados = 'tradicional_api';
            }
          }

          // Verificar variations
          let descricaoVariations = '';
          if (itemData.variations && itemData.variations.length > 0) {
            itemData.variations.forEach((variation, index) => {
              if (variation.description) {
                descricaoVariations += variation.description + ' ';
                console.log(`🔍 DEBUG - Descrição da variação ${index}:`, variation.description.substring(0, 100));
              }
            });
          }

          // Combinar todos os textos disponíveis
          const textoCompleto = [
            textosTitulo,
            textosDescricao,
            descricaoCompleta,
            descricaoVariations,
            textosAtributos
          ].filter(texto => texto && texto.trim().length > 0)
           .join(' ')
           .toLowerCase()
           .replace(/\s+/g, ' ')
           .trim();

          console.log(`🔍 DEBUG - Componentes do texto final:`);
          console.log(`   - Título: ${textosTitulo.length} chars`);
          console.log(`   - Descrição básica: ${textosDescricao.length} chars`);
          console.log(`   - Descrição completa: ${descricaoCompleta.length} chars (fonte: ${fonteDados})`);
          console.log(`   - Descrição variations: ${descricaoVariations.length} chars`);
          console.log(`   - Atributos: ${textosAtributos.length} chars`);
          console.log(`   - TOTAL FINAL: ${textoCompleto.length} chars`);

          // Mostrar amostra do texto final
          console.log(`🔍 DEBUG - TEXTO FINAL (primeiros 200 chars):`, textoCompleto.substring(0, 200));
          console.log(`🔍 DEBUG - TEXTO FINAL (últimos 200 chars):`, textoCompleto.substring(Math.max(0, textoCompleto.length - 200)));

          // Verificar se contém o texto pesquisado
          const textoPesquisaLower = textoPesquisa.toLowerCase();
          const contemTexto = textoCompleto.includes(textoPesquisaLower);
          
          console.log(`�� DEBUG - Procurando por: "${textoPesquisaLower}"`);
          console.log(`�� DEBUG - Contém texto? ${contemTexto}`);

          // Se não encontrou, fazer busca detalhada para debug
          if (!contemTexto) {
            console.log(`🔍 DEBUG - Fazendo busca detalhada...`);
            
            // Buscar palavras individuais
            const palavrasPesquisa = textoPesquisaLower.split(' ').filter(p => p.length > 0);
            palavrasPesquisa.forEach(palavra => {
              const encontrou = textoCompleto.includes(palavra);
              const posicao = textoCompleto.indexOf(palavra);
              console.log(`🔍 DEBUG - Palavra "${palavra}": ${encontrou ? `✅ encontrada na posição ${posicao}` : '❌ não encontrada'}`);
              
              if (encontrou && posicao >= 0) {
                const contexto = textoCompleto.substring(Math.max(0, posicao - 30), posicao + palavra.length + 30);
                console.log(`�� DEBUG - Contexto de "${palavra}": "${contexto}"`);
              }
            });
            
            // Buscar palavras similares
            const palavrasSimilares = ['volume', 'volumes', 'vol', 'unidade', 'unidades', 'peça', 'peças', 'você irá receber'];
            palavrasSimilares.forEach(palavra => {
              if (textoCompleto.includes(palavra)) {
                const posicao = textoCompleto.indexOf(palavra);
                const contexto = textoCompleto.substring(Math.max(0, posicao - 30), posicao + palavra.length + 30);
                console.log(`🔍 DEBUG - Palavra similar "${palavra}" encontrada: "${contexto}"`);
              }
            });
          }

          // Análise detalhada de ocorrências
          let analiseDetalhada = null;
          let totalOcorrencias = 0;

          if (contemTexto) {
            analiseDetalhada = this.encontrarTrechosDetalhados(textoCompleto, textoPesquisaLower);
            totalOcorrencias = analiseDetalhada.total_ocorrencias;
            
            console.log(`✅ Texto "${textoPesquisa}" encontrado ${totalOcorrencias} vezes em ${mlbId}: ${itemData.title}`);
            console.log(`📊 Densidade: ${analiseDetalhada.estatisticas?.densidade_por_1000_chars || 'N/A'}`);
            
            // Atualizar estatísticas gerais
            resultados.estatisticas_gerais.total_ocorrencias += totalOcorrencias;
            resultados.estatisticas_gerais.palavras_analisadas += textoCompleto.split(' ').length;
          } else {
            console.log(`❌ Texto NÃO encontrado em ${mlbId}: ${itemData.title}`);
          }

          const resultadoItem = {
            mlb_id: mlbId,
            titulo: itemData.title,
            preco: itemData.price,
            status: itemData.status,
            categoria: itemData.category_id,
            seller_id: itemData.seller_id,
            catalog_product_id: itemData.catalog_product_id,
            tipo_anuncio: tipoAnuncio.toLowerCase(),
            fonte_dados: fonteDados,
            contem_texto: contemTexto,
            total_ocorrencias: totalOcorrencias,
            analise_detalhada: analiseDetalhada,
            url_item: `https://produto.mercadolivre.com.br/${mlbId}`,
            dados_completos: {
              titulo: textosTitulo,
              descricao_basica: textosDescricao,
              descricao_completa: descricaoCompleta.substring(0, 500) + (descricaoCompleta.length > 500 ? '...' : ''),
              descricao_variations: descricaoVariations.substring(0, 200) + (descricaoVariations.length > 200 ? '...' : ''),
              atributos_texto: textosAtributos,
              tamanho_texto_total: textoCompleto.length,
              palavras_total: textoCompleto.split(' ').length
            }
          };

          if (contemTexto) {
            resultados.mlbs_com_texto.push(resultadoItem);
            resultados.resumo.encontrados++;
          } else {
            resultados.mlbs_sem_texto.push(resultadoItem);
            resultados.resumo.nao_encontrados++;
          }

          // Delay para evitar rate limit
          if (i < mlbIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 800)); // Aumentado para 800ms devido ao fetch
          }

        } catch (error) {
          console.error(`❌ Erro ao processar ${mlbId}:`, error.message);
          resultados.mlbs_com_erro.push({
            mlb_id: mlbId,
            erro: error.message,
            motivo: 'Erro interno',
            detalhes: 'Erro inesperado durante o processamento'
          });
          resultados.resumo.erros++;
        }
      }

      // Calcular estatísticas finais
      if (resultados.resumo.encontrados > 0) {
        resultados.estatisticas_gerais.densidade_media = 
          (resultados.estatisticas_gerais.total_ocorrencias / resultados.estatisticas_gerais.palavras_analisadas * 1000).toFixed(2);
      }

      console.log(`✅ Pesquisa HÍBRIDA CORRIGIDA concluída: ${resultados.resumo.encontrados} encontrados, ${resultados.resumo.nao_encontrados} não encontrados, ${resultados.resumo.erros} erros`);
      console.log(`📊 Total de ocorrências encontradas: ${resultados.estatisticas_gerais.total_ocorrencias}`);

      return {
        success: true,
        resultados: resultados
      };

    } catch (error) {
      console.error('❌ Erro geral na pesquisa:', error.message);
      return {
        success: false,
        message: error.message,
        error: true
      };
    }
  }  // 📄 MÉTODO PARA ANÚNCIOS TRADICIONAIS (API)
  static async obterDescricaoTradicional(mlbId, headers) {
    try {
      console.log(`📄 DEBUG - Obtendo descrição tradicional via API...`);
      
      // Tentar endpoint principal de descrição
      const descResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}/description`, { headers });
      
      if (descResponse.ok) {
        const descData = await descResponse.json();
        console.log(`🔍 DEBUG - Campos disponíveis:`, Object.keys(descData));
        
        const descricao = descData.plain_text || descData.text || '';
        
        if (descricao && descricao.length > 50) {
          console.log(`✅ DEBUG - Descrição tradicional obtida (${descricao.length} chars):`, descricao.substring(0, 100) + '...');
          return descricao;
        } else {
          console.log(`❌ DEBUG - Descrição tradicional vazia ou muito pequena`);
        }
      } else {
        console.log(`❌ DEBUG - Erro ${descResponse.status} ao obter descrição tradicional`);
      }
      
      return '';
      
    } catch (error) {
      console.log(`❌ DEBUG - Erro ao obter descrição tradicional:`, error.message);
      return '';
    }
  }

  // 📦 MÉTODO PARA ANÚNCIOS DE CATÁLOGO (API)
  static async obterDescricaoCatalogo(itemData, headers) {
    try {
      console.log(`📦 DEBUG - Obtendo descrição de catálogo via API...`);
      
      if (!itemData.catalog_product_id) {
        return '';
      }
      
      // Testar endpoint de produtos
      const catalogResponse = await fetch(`https://api.mercadolibre.com/products/${itemData.catalog_product_id}`, { headers });
      
      if (catalogResponse.ok) {
        const catalogData = await catalogResponse.json();
        console.log(`✅ DEBUG - Catálogo acessado via API`);
        console.log(`🔍 DEBUG - Campos do catálogo:`, Object.keys(catalogData));
        
        const possiveisDescricoes = [];
        
        // Coletar diferentes campos de descrição
        if (catalogData.description && typeof catalogData.description === 'string') {
          possiveisDescricoes.push(catalogData.description);
          console.log(`✅ DEBUG - Campo 'description' encontrado (${catalogData.description.length} chars)`);
        }
        
        if (catalogData.short_description && typeof catalogData.short_description === 'string') {
          possiveisDescricoes.push(catalogData.short_description);
          console.log(`✅ DEBUG - Campo 'short_description' encontrado (${catalogData.short_description.length} chars)`);
        }
        
        if (catalogData.long_description && typeof catalogData.long_description === 'string') {
          possiveisDescricoes.push(catalogData.long_description);
          console.log(`✅ DEBUG - Campo 'long_description' encontrado (${catalogData.long_description.length} chars)`);
        }
        
        if (catalogData.main_features && Array.isArray(catalogData.main_features)) {
          const features = catalogData.main_features
            .filter(feature => feature && typeof feature === 'string')
            .join(' ');
          if (features.length > 20) {
            possiveisDescricoes.push(features);
            console.log(`✅ DEBUG - Campo 'main_features' encontrado (${features.length} chars)`);
          }
        }
        
        // Enhanced content
        if (catalogData.enhanced_content && typeof catalogData.enhanced_content === 'string') {
          possiveisDescricoes.push(catalogData.enhanced_content);
          console.log(`✅ DEBUG - Campo 'enhanced_content' encontrado (${catalogData.enhanced_content.length} chars)`);
        }
        
        // Atributos do catálogo
        if (catalogData.attributes && Array.isArray(catalogData.attributes)) {
          const atributosCatalogo = catalogData.attributes
            .map(attr => {
              const nome = attr.name || '';
              const valor = attr.value_name || attr.value_struct?.number || attr.value_struct?.unit || '';
              return `${nome} ${valor}`.trim();
            })
            .filter(texto => texto.length > 0)
            .join(' ');
          
          if (atributosCatalogo.length > 50) {
            possiveisDescricoes.push(atributosCatalogo);
            console.log(`✅ DEBUG - Atributos do catálogo encontrados (${atributosCatalogo.length} chars)`);
          }
        }
        
        // Nome do produto
        if (catalogData.name && typeof catalogData.name === 'string' && catalogData.name.length > 50) {
          possiveisDescricoes.push(catalogData.name);
          console.log(`✅ DEBUG - Campo 'name' encontrado (${catalogData.name.length} chars)`);
        }
        
        // Filtrar e combinar
        const descricoesFiltradas = possiveisDescricoes.filter(desc => {
          if (!desc) return false;
          if (typeof desc !== 'string') return false;
          return desc.trim().length > 20;
        });
        
        if (descricoesFiltradas.length > 0) {
          const descricaoFinal = descricoesFiltradas.join(' ').trim();
          console.log(`✅ DEBUG - Descrição de catálogo obtida via API (${descricaoFinal.length} chars)`);
          return descricaoFinal;
        }
      } else {
        console.log(`❌ DEBUG - Erro ${catalogResponse.status} ao acessar catálogo via API`);
      }
      
      return '';
      
    } catch (error) {
      console.log(`❌ DEBUG - Erro ao obter descrição de catálogo via API:`, error.message);
      return '';
    }
  }

  // 🌐 MÉTODO FETCH CORRIGIDO COM SELETORES ESPECÍFICOS PARA MERCADOLIBRE
 // 🌐 MÉTODO FETCH CORRIGIDO COM EXTRAÇÃO AGRESSIVA
static async extrairDescricaoViaFetch(permalink) {
  try {
    console.log(`🌐 DEBUG - Fetch da página de catálogo: ${permalink}`);
    
    const response = await fetch(permalink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      timeout: 15000
    });
    
    if (!response.ok) {
      console.log(`❌ DEBUG - Erro HTTP ${response.status} no fetch`);
      return '';
    }
    
    const html = await response.text();
    console.log(`📏 DEBUG - HTML obtido: ${html.length} chars`);
    
    // 🔥 EXTRAÇÃO AGRESSIVA IMEDIATA
    console.log(`🔥 DEBUG - INICIANDO EXTRAÇÃO AGRESSIVA COMPLETA...`);
    
    // Remover scripts e styles primeiro
    let htmlLimpo = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    
    // Extrair texto completo da página
    let textoCompleto = htmlLimpo
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`�� DEBUG - Texto limpo extraído: ${textoCompleto.length} chars`);
    
    // Verificar se contém "01 volume"
    if (textoCompleto.toLowerCase().includes('01 volume')) {
      console.log(`🎉 DEBUG - EXTRAÇÃO AGRESSIVA SUCESSO! "01 volume" encontrado!`);
      console.log(`📝 DEBUG - Amostra do texto: ${textoCompleto.substring(0, 500)}...`);
      return textoCompleto;
    }
    
    // Se não encontrou "01 volume", buscar por outros indicadores
    const indicadores = ['dimensões', 'especificações', 'você irá receber', 'produto', 'características'];
    let encontrouIndicador = false;
    
    for (const indicador of indicadores) {
      if (textoCompleto.toLowerCase().includes(indicador)) {
        encontrouIndicador = true;
        console.log(`✅ DEBUG - Indicador "${indicador}" encontrado, retornando texto completo`);
        break;
      }
    }
    
    if (encontrouIndicador && textoCompleto.length > 1000) {
      console.log(`🎯 DEBUG - Texto rico extraído (${textoCompleto.length} chars)`);
      return textoCompleto;
    }
    
    console.log(`❌ DEBUG - Extração agressiva não encontrou conteúdo relevante`);
    return '';
    
  } catch (error) {
    console.log(`❌ DEBUG - Erro no fetch:`, error.message);
    return '';
  }
}

  // ✅ FUNÇÃO EXTRAIR TEXTOS DOS ATRIBUTOS
  static extrairTextosAtributos(attributes) {
    if (!Array.isArray(attributes)) return '';
    
    return attributes
      .map(attr => {
        const nome = attr.name || '';
        const valor = attr.value_name || attr.value_struct?.number || attr.value_struct?.unit || '';
        return `${nome} ${valor}`;
      })
      .join(' ');
  }  // Encontrar trechos com análise completa
  static encontrarTrechosDetalhados(textoCompleto, textoPesquisa, tamanhoTrecho = 150) {
    const trechos = [];
    const ocorrencias = [];
    let index = 0;
    
    console.log(`🔍 Iniciando análise DETALHADA para "${textoPesquisa}"`);
    
    // Primeiro, encontrar todas as posições
    while ((index = textoCompleto.indexOf(textoPesquisa, index)) !== -1) {
      ocorrencias.push(index);
      index += textoPesquisa.length;
    }
    
    console.log(`📊 Encontradas ${ocorrencias.length} ocorrências de "${textoPesquisa}"`);
    
    // Analisar contexto geral do texto
    const palavrasTexto = textoCompleto.split(' ');
    const totalPalavras = palavrasTexto.length;
    const totalCaracteres = textoCompleto.length;
    
    // Depois, criar trechos detalhados para cada ocorrência
    ocorrencias.forEach((posicao, i) => {
      const inicio = Math.max(0, posicao - tamanhoTrecho / 2);
      const fim = Math.min(textoCompleto.length, posicao + textoPesquisa.length + tamanhoTrecho / 2);
      
      let trecho = textoCompleto.substring(inicio, fim);
      
      // Limpar o trecho
      trecho = trecho.replace(/\s+/g, ' ').trim();
      
      // Adicionar indicadores de continuação
      if (inicio > 0) trecho = '...' + trecho;
      if (fim < textoCompleto.length) trecho = trecho + '...';
      
      // Destacar o texto encontrado
      const regex = new RegExp(`(${textoPesquisa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const trechoDestacado = trecho.replace(regex, '**$1**');
      
      // Identificar em que seção do texto está
      let secao = 'meio da descrição';
      let porcentagemPosicao = (posicao / totalCaracteres * 100).toFixed(1);
      
      if (posicao < totalCaracteres * 0.1) secao = 'início do texto';
      else if (posicao < totalCaracteres * 0.3) secao = 'primeira parte';
      else if (posicao > totalCaracteres * 0.7) secao = 'parte final';
      else if (posicao > totalCaracteres * 0.9) secao = 'final do texto';
      
      // Analisar palavras ao redor
      const palavraAntes = textoCompleto.substring(Math.max(0, posicao - 100), posicao)
        .split(' ').slice(-10).join(' ').trim();
      const palavraDepois = textoCompleto.substring(posicao + textoPesquisa.length, 
        Math.min(textoCompleto.length, posicao + textoPesquisa.length + 100))
        .split(' ').slice(0, 10).join(' ').trim();
      
      // Calcular distância da ocorrência anterior
      let distanciaAnterior = null;
      if (i > 0) {
        distanciaAnterior = posicao - ocorrencias[i - 1];
      }
      
      trechos.push({
        ocorrencia: i + 1,
        posicao: posicao,
        posicao_percentual: porcentagemPosicao + '%',
        secao: secao,
        trecho: trechoDestacado,
        tamanho_trecho: trecho.length,
        contexto: {
          antes: palavraAntes,
          depois: palavraDepois
        },
        analise: {
          distancia_anterior: distanciaAnterior,
          caracteres_antes: posicao,
          caracteres_depois: totalCaracteres - posicao - textoPesquisa.length
        }
      });
      
      console.log(`   ✅ Ocorrência ${i + 1}: posição ${posicao} (${porcentagemPosicao}% do texto) - ${secao}`);
    });
    
    // Calcular estatísticas avançadas
    const densidade = totalCaracteres > 0 ? (ocorrencias.length / totalCaracteres * 1000).toFixed(3) : '0';
    const densidadePorPalavra = totalPalavras > 0 ? (ocorrencias.length / totalPalavras * 100).toFixed(2) : '0';
    
    // Analisar distribuição das ocorrências
    let distribuicao = 'uniforme';
    if (ocorrencias.length > 1) {
      const distancias = [];
      for (let i = 1; i < ocorrencias.length; i++) {
        distancias.push(ocorrencias[i] - ocorrencias[i - 1]);
      }
      const mediaDistancia = distancias.reduce((a, b) => a + b, 0) / distancias.length;
      const variancia = distancias.reduce((acc, dist) => acc + Math.pow(dist - mediaDistancia, 2), 0) / distancias.length;
      
      if (variancia > mediaDistancia) distribuicao = 'irregular';
      else if (variancia < mediaDistancia / 3) distribuicao = 'regular';
    }
    
    console.log(`📈 Densidade: ${densidade} ocorrências por 1000 caracteres`);
    console.log(`📊 Distribuição: ${distribuicao}`);
    
    return {
      total_ocorrencias: ocorrencias.length,
      posicoes: ocorrencias,
      trechos: trechos,
      estatisticas: {
        densidade_por_1000_chars: densidade,
        densidade_por_100_palavras: densidadePorPalavra,
        distribuicao: distribuicao,
        texto_total_caracteres: totalCaracteres,
        texto_total_palavras: totalPalavras,
        primeira_ocorrencia: ocorrencias[0] || null,
        ultima_ocorrencia: ocorrencias[ocorrencias.length - 1] || null,
        espalhamento: ocorrencias.length > 1 ? 
          ((ocorrencias[ocorrencias.length - 1] - ocorrencias[0]) / totalCaracteres * 100).toFixed(1) + '%' : '0%'
      }
    };
  }

  // ✅ FUNÇÃO analisarRelevancia ADICIONADA
  static analisarRelevancia(analiseDetalhada, textoPesquisa) {
    if (!analiseDetalhada || analiseDetalhada.total_ocorrencias === 0) {
      return {
        nivel: 'nenhuma',
        pontuacao: 0,
        descricao: 'Texto não encontrado'
      };
    }

    const { total_ocorrencias, estatisticas } = analiseDetalhada;
    let pontuacao = 0;

    // Pontuação baseada no número de ocorrências
    pontuacao += Math.min(total_ocorrencias * 10, 50);

    // Pontuação baseada na densidade
    const densidade = parseFloat(estatisticas.densidade_por_1000_chars);
    if (densidade > 5) pontuacao += 30;
    else if (densidade > 2) pontuacao += 20;
    else if (densidade > 1) pontuacao += 10;

    // Pontuação baseada na distribuição
    if (estatisticas.distribuicao === 'regular') pontuacao += 15;
    else if (estatisticas.distribuicao === 'uniforme') pontuacao += 10;

    // Pontuação baseada no espalhamento
    const espalhamento = parseFloat(estatisticas.espalhamento);
    if (espalhamento > 50) pontuacao += 20;
    else if (espalhamento > 25) pontuacao += 10;

    // Determinar nível de relevância
    let nivel, descricao;
    if (pontuacao >= 80) {
      nivel = 'muito_alta';
      descricao = 'Texto muito relevante - múltiplas ocorrências bem distribuídas';
    } else if (pontuacao >= 60) {
      nivel = 'alta';
      descricao = 'Texto relevante - várias ocorrências';
    } else if (pontuacao >= 40) {
      nivel = 'media';
      descricao = 'Texto moderadamente relevante';
    } else if (pontuacao >= 20) {
      nivel = 'baixa';
      descricao = 'Texto pouco relevante - poucas ocorrências';
    } else {
      nivel = 'muito_baixa';
      descricao = 'Texto minimamente relevante';
    }

    return {
      nivel,
      pontuacao,
      descricao,
      detalhes: {
        ocorrencias: total_ocorrencias,
        densidade: densidade,
        distribuicao: estatisticas.distribuicao,
        espalhamento: espalhamento
      }
    };
  }

  // Função para listar MLBs da sua conta
  static async listarMeusMLBs(access_token = null, limit = 50) {
    try {
      if (!access_token) {
        access_token = await TokenService.renovarTokenSeNecessario();
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      console.log(`🔍 Buscando seus MLBs...`);

      const response = await fetch(`https://api.mercadolibre.com/users/me/items/search?limit=${limit}`, { headers });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      console.log(`✅ Encontrados ${data.results?.length || 0} MLBs na sua conta`);
      
      const mlbsDetalhados = [];
      
      if (data.results && data.results.length > 0) {
        for (const mlbId of data.results.slice(0, 10)) {
          try {
            const itemResponse = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, { headers });
            
            if (itemResponse.ok) {
              const itemData = await itemResponse.json();
              mlbsDetalhados.push({
                mlb_id: mlbId,
                titulo: itemData.title,
                preco: itemData.price,
                status: itemData.status,
                categoria: itemData.category_id,
                catalog_product_id: itemData.catalog_product_id,
                tipo_anuncio: itemData.catalog_product_id ? 'catálogo' : 'tradicional'
              });
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            console.log(`❌ Erro ao obter detalhes de ${mlbId}:`, error.message);
          }
        }
      }

      return {
        success: true,
        total_encontrados: data.results?.length || 0,
        mlbs_detalhados: mlbsDetalhados,
        todos_mlbs: data.results || []
      };

    } catch (error) {
      console.error('❌ Erro ao listar MLBs:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }  // Processar lista de MLBs em lote
  static async processarPesquisaLote(processId, mlbIds, textoPesquisa, processamentosPesquisa) {
    const status = processamentosPesquisa[processId];
    status.status = 'processando';
    status.texto_pesquisado = textoPesquisa;
    
    try {
      const resultado = await this.pesquisarTextoEmDescricoes(mlbIds, textoPesquisa);
      
      if (resultado.success) {
        status.resultados = resultado.resultados;
        status.status = 'concluido';
      } else {
        status.status = 'erro';
        status.erro = resultado.message;
      }
      
    } catch (error) {
      console.error('❌ Erro no processamento em lote:', error.message);
      status.status = 'erro';
      status.erro = error.message;
    }
    
    status.concluido_em = new Date();
  }
}

module.exports = PesquisaDescricaoService;