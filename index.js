require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(__dirname)); // Servir arquivos estáticos

// Variáveis globais para processamentos
let processamentoPromocao = {};
let processamentosRemocao = {};

// Configurações específicas - CORRIGIDA
const CONFIG = {
  diretorio_saida: 'C:\Users\USER\Documents\Projetos\ml', // Escape correto
  arquivo_csv: 'anuncios_ativos_promocao.csv',
  encoding: 'utf8'
};

// ===== FUNÇÕES AUXILIARES =====

// Função para renovar token automaticamente
async function renovarTokenSeNecessario() {
  try {
    const access_token = process.env.ACCESS_TOKEN;
    
    // Testar se o token atual funciona
    const testResponse = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { "Authorization": `Bearer ${access_token}` }
    });

    if (testResponse.ok) {
      console.log('✅ Token atual válido');
      return access_token;
    }

    console.log('🔄 Token expirado, renovando...');
    
    // Renovar token
    const app_id = process.env.APP_ID;
    const client_secret = process.env.CLIENT_SECRET;
    const refresh_token = process.env.REFRESH_TOKEN;

    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: 'POST',
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`
    });

    if (!response.ok) {
      throw new Error('Falha ao renovar token');
    }

    const data = await response.json();
    
    console.log('✅ Token renovado com sucesso!');
    console.log('Novo token:', data.access_token.substring(0, 20) + '...');
    
    // Atualizar variável de ambiente temporariamente
    process.env.ACCESS_TOKEN = data.access_token;
    
    return data.access_token;

  } catch (error) {
    console.error('❌ Erro ao renovar token:', error.message);
    throw error;
  }
}

// ===== ENDPOINTS BÁSICOS =====

// Rota GET de teste
app.get('/test', (req, res) => {
  res.send('Servidor Node.js com Express está rodando!');
});

// Endpoint principal - SERVIR ARQUIVO HTML
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'dashboard.html');
  
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send(`
      <h1>❌ Arquivo dashboard.html não encontrado</h1>
      <p><a href="/criar-dashboard">🔧 Criar dashboard automaticamente</a></p>
    `);
  }
});

// Endpoint para servir arquivo de remoção
app.get('/remover-promocao', (req, res) => {
  const htmlPath = path.join(__dirname, 'remover-promocao.html');
  
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send(`
      <h1>❌ Arquivo remover-promocao.html não encontrado</h1>
      <p><a href="/criar-arquivo-remocao">🔧 Criar arquivo automaticamente</a></p>
    `);
  }
});

// ===== ENDPOINTS DE TOKEN =====

// Endpoint para renovar token
app.post('/getAccessToken', async (req, res) => {
  try {
    const app_id = process.env.APP_ID;
    const client_secret = process.env.CLIENT_SECRET;
    const refresh_token = process.env.REFRESH_TOKEN;

    const url_principal = "https://api.mercadolibre.com/oauth/token";

    const headers = {
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded"
    };

    const dados = `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`;

    const resposta = await fetch(url_principal, {
      method: 'POST',
      headers: headers,
      body: dados
    });

    if (!resposta.ok) {
      const errorData = await resposta.json();
      throw new Error(`Erro na API: ${errorData.error || errorData.message || 'Erro desconhecido'}`);
    }

    const resposta_json = await resposta.json();
    
    console.log('Token renovado com sucesso:', {
      access_token: resposta_json.access_token,
      expires_in: resposta_json.expires_in,
      refresh_token: resposta_json.refresh_token
    });

    res.json({
      success: true,
      access_token: resposta_json.access_token,
      expires_in: resposta_json.expires_in,
      refresh_token: resposta_json.refresh_token || refresh_token
    });

  } catch (error) {
    console.error('Erro ao renovar token:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para renovar e atualizar token automaticamente
app.post('/renovar-token-automatico', async (req, res) => {
  try {
    const app_id = process.env.APP_ID;
    const client_secret = process.env.CLIENT_SECRET;
    const refresh_token = process.env.REFRESH_TOKEN;

    if (!app_id || !client_secret || !refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Credenciais não configuradas no .env'
      });
    }

    console.log('🔄 Renovando token...');

    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: 'POST',
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Erro na API: ${errorData.error || errorData.message || 'Erro desconhecido'}`);
    }

    const data = await response.json();
    
    // Atualizar variável de ambiente em tempo real
    process.env.ACCESS_TOKEN = data.access_token;
    
    console.log('✅ Token renovado e atualizado!');
    console.log('Novo token:', data.access_token.substring(0, 20) + '...');

    // Testar o novo token
    const testResponse = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { "Authorization": `Bearer ${data.access_token}` }
    });

    if (testResponse.ok) {
      const userData = await testResponse.json();
      
      res.json({
        success: true,
        message: 'Token renovado e testado com sucesso!',
        access_token: data.access_token,
        expires_in: data.expires_in,
        user_id: userData.id,
        nickname: userData.nickname,
        refresh_token: data.refresh_token || refresh_token
      });
    } else {
      throw new Error('Token renovado mas não funciona');
    }

  } catch (error) {
    console.error('❌ Erro ao renovar token:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para verificar e auto-renovar token se necessário
app.get('/verificar-token', async (req, res) => {
  try {
    const access_token = process.env.ACCESS_TOKEN;
    
    if (!access_token) {
      return res.status(400).json({
        success: false,
        error: 'ACCESS_TOKEN não configurado'
      });
    }

    // Testar token atual
    const testResponse = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { "Authorization": `Bearer ${access_token}` }
    });

    if (testResponse.ok) {
      const userData = await testResponse.json();
      res.json({
        success: true,
        message: 'Token válido',
        user_id: userData.id,
        nickname: userData.nickname,
        token_preview: access_token.substring(0, 20) + '...'
      });
    } else {
      // Token inválido, tentar renovar automaticamente
      console.log('🔄 Token inválido, tentando renovar...');
      
      const renovarResponse = await fetch('http://localhost:3000/renovar-token-automatico', {
        method: 'POST'
      });
      
      if (renovarResponse.ok) {
        const renovarData = await renovarResponse.json();
        res.json({
          success: true,
          message: 'Token era inválido mas foi renovado automaticamente',
          ...renovarData
        });
      } else {
        res.status(401).json({
          success: false,
          error: 'Token inválido e não foi possível renovar'
        });
      }
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para testar token
app.get('/test-token', async (req, res) => {
  try {
    const access_token = process.env.ACCESS_TOKEN;
    if (!access_token) {
      return res.status(401).json({
        success: false,
        error: 'ACCESS_TOKEN não configurado no .env'
      });
    }

    const headers = {
      "Authorization": `Bearer ${access_token}`,
      "Content-Type": "application/json"
    };

    const response = await fetch('https://api.mercadolibre.com/users/me', { headers });
    
    if (response.ok) {
      const data = await response.json();
      res.json({
        success: true,
        user_id: data.id,
        nickname: data.nickname,
        message: "Token funcionando perfeitamente!"
      });
    } else {
      const errorData = await response.json();
      res.status(response.status).json({
        success: false,
        error: errorData,
        message: "Token com problema"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== FUNÇÃO MELHORADA DE REMOÇÃO DE PROMOÇÃO =====

// Função CORRETA para remover promoções usando API oficial do ML
async function removerPromocaoUnico(mlbId, access_token = null) {
  try {
    // Se não foi fornecido token, tentar renovar automaticamente
    if (!access_token) {
      access_token = await renovarTokenSeNecessario();
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
      access_token = await renovarTokenSeNecessario();
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
    
    const userResponse = await fetch('https://api.mercadolibre.com/users/me', { headers });
    const userData = await userResponse.json();
    
    if (itemData.seller_id !== userData.id) {
      throw new Error('Este anúncio não pertence à sua conta');
    }

    console.log(`✅ Anúncio encontrado: ${itemData.title}`);

    // 2. Consultar promoções ativas do item usando API oficial
    console.log(`🔍 Consultando promoções do item ${mlbId}...`);
    
    const promotionsResponse = await fetch(`https://api.mercadolibre.com/seller-promotions/items/${mlbId}?app_version=v2`, { headers });
    
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
          
          const deleteResponse = await fetch(`https://api.mercadolibre.com/seller-promotions/items/${mlbId}?app_version=v2`, {
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
    const verificacaoResponse = await fetch(`https://api.mercadolibre.com/seller-promotions/items/${mlbId}?app_version=v2`, { headers });
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

// ===== ENDPOINTS DE REMOÇÃO DE PROMOÇÃO =====

// Endpoint para remover promoção de um único anúncio
app.post('/anuncio/remover-promocao', async (req, res) => {
  try {
    const { mlb_id } = req.body;
    
    if (!mlb_id) {
      return res.status(400).json({
        success: false,
        error: 'MLB ID é obrigatório'
      });
    }

    console.log(`🎯 Iniciando remoção de promoção para: ${mlb_id}`);
    
    const resultado = await removerPromocaoUnico(mlb_id);
    
    res.json(resultado);

  } catch (error) {
    console.error('❌ Erro no endpoint de remoção:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para remover promoções em lote
app.post('/anuncios/remover-promocoes-lote', async (req, res) => {
  try {
    const { mlb_ids, delay_entre_remocoes = 3000 } = req.body;
    
    if (!mlb_ids || !Array.isArray(mlb_ids) || mlb_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Lista de MLB IDs é obrigatória'
      });
    }

    const processId = Date.now().toString();
    
    // Inicializar status do processamento
    processamentosRemocao[processId] = {
      id: processId,
      status: 'iniciando',
      total_anuncios: mlb_ids.length,
      processados: 0,
      sucessos: 0,
      erros: 0,
      progresso: 0,
      iniciado_em: new Date(),
      resultados: []
    };

    // Responder imediatamente com o ID do processo
    res.json({
      success: true,
      message: 'Processamento iniciado',
      process_id: processId,
      total_anuncios: mlb_ids.length
    });

    // Processar em background
    processarRemocaoLote(processId, mlb_ids, delay_entre_remocoes);

  } catch (error) {
    console.error('❌ Erro no endpoint de lote:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Função para processar remoção em lote (background)
async function processarRemocaoLote(processId, mlbIds, delay) {
  const status = processamentosRemocao[processId];
  status.status = 'processando';
  
  console.log(`🚀 Iniciando processamento em lote: ${mlbIds.length} anúncios`);

  for (let i = 0; i < mlbIds.length; i++) {
    const mlbId = mlbIds[i].trim();
    
    if (!mlbId) continue;

    try {
      console.log(`📋 Processando ${i + 1}/${mlbIds.length}: ${mlbId}`);
      
      const resultado = await removerPromocaoUnico(mlbId);
      
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

// Endpoint para status de remoção
app.get('/anuncios/status-remocao/:id', (req, res) => {
  const status = processamentosRemocao[req.params.id];
  if (!status) {
    return res.status(404).json({ error: 'Processamento não encontrado' });
  }
  res.json(status);
});

// ===== ENDPOINTS PARA CRIAR ARQUIVOS HTML =====

// Criar dashboard
app.get('/criar-dashboard', (req, res) => {
  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Mercado Livre - Dashboard</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 600px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        .endpoints {
            display: grid;
            gap: 15px;
            margin-top: 30px;
        }
        .endpoint {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #007bff;
            text-align: left;
        }
        .endpoint h3 {
            margin: 0 0 10px 0;
            color: #007bff;
        }
        .endpoint p {
            margin: 0;
            color: #666;
        }
        .endpoint a, .endpoint button {
            color: #007bff;
            text-decoration: none;
            font-weight: 600;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
        }
        .endpoint a:hover, .endpoint button:hover {
            text-decoration: underline;
        }
        .status {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 10px;
        }
        .status.active {
            background: #d4edda;
            color: #155724;
        }
        .status.warning {
            background: #fff3cd;
            color: #856404;
        }
        .token-actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛒 API Mercado Livre</h1>
        <p>Servidor Node.js rodando com sucesso!</p>
        
        <div class="endpoints">
            <div class="endpoint">
                <h3>🔑 Gerenciar Token <span class="status warning">IMPORTANTE</span></h3>
                <p>Verificar e renovar ACCESS_TOKEN</p>
                <div class="token-actions">
                    <button onclick="verificarToken()">🔍 Verificar Token</button>
                    <button onclick="renovarToken()">🔄 Renovar Token</button>
                </div>
            </div>
            
            <div class="endpoint">
                <h3>🎯 Remover Promoções <span class="status active">ATIVO</span></h3>
                <p>Interface para remover promoções de anúncios</p>
                <a href="/remover-promocao">Acessar Interface</a>
            </div>
            
            <div class="endpoint">
                <h3>🔧 Debug <span class="status active">ATIVO</span></h3>
                <p>Verificar endpoints disponíveis</p>
                <a href="/debug/routes">Ver Rotas</a>
            </div>
        </div>
    </div>

    <script>
        async function verificarToken() {
            try {
                const response = await fetch('/verificar-token');
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ ' + data.message + '\nUser: ' + data.nickname + '\nToken: ' + data.token_preview);
                } else {
                    alert('❌ ' + data.error);
                }
            } catch (error) {
                alert('❌ Erro: ' + error.message);
            }
        }

        async function renovarToken() {
            try {
                const response = await fetch('/renovar-token-automatico', {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert('✅ ' + data.message + '\nUser: ' + data.nickname + '\nNovo token: ' + data.access_token.substring(0, 20) + '...');
                } else {
                    alert('❌ ' + data.error);
                }
            } catch (error) {
                alert('❌ Erro: ' + error.message);
            }
        }
    </script>
</body>
</html>`;

  const htmlPath = path.join(__dirname, 'dashboard.html');
  
  try {
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    res.send(`
      <h1>✅ Dashboard criado com sucesso!</h1>
      <p>O arquivo <strong>dashboard.html</strong> foi criado em:</p>
      <p><code>${htmlPath}</code></p>
      <p><a href="/">🏠 Acessar Dashboard</a></p>
    `);
  } catch (error) {
    res.status(500).send(`
      <h1>❌ Erro ao criar dashboard</h1>
      <p>Erro: ${error.message}</p>
    `);
  }
});

// Criar arquivo de remoção
app.get('/criar-arquivo-remocao', (req, res) => {
  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remover Promoções - ML</title>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            max-width: 900px; 
            margin: 50px auto; 
            padding: 20px; 
            background: #f8f9fa;
        }
        .container { 
            background: white; 
            padding: 40px; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #dc3545; 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        .form-group { 
            margin-bottom: 25px; 
        }
        label { 
            display: block; 
            margin-bottom: 8px; 
            font-weight: 600; 
            color: #333;
        }
        input, textarea { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #e9ecef; 
            border-radius: 8px; 
            font-size: 16px;
            transition: border-color 0.3s ease;
            box-sizing: border-box;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }
        button { 
            background: #dc3545; 
            color: white; 
            padding: 15px 30px; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            margin-right: 15px; 
            margin-bottom: 15px;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        button:hover { 
            background: #c82333; 
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(220,53,69,0.3);
        }
        .btn-secondary { 
            background: #6c757d; 
        }
        .btn-secondary:hover { 
            background: #545b62; 
        }
        .btn-warning {
            background: #ffc107;
            color: #212529;
        }
        .btn-warning:hover {
            background: #e0a800;
        }
        .result { 
            margin-top: 30px; 
            padding: 20px; 
            border-radius: 10px; 
            font-family: 'Courier New', monospace;
            white-space: pre-wrap;
        }
        .success { 
            background: #d4edda; 
            border: 2px solid #c3e6cb; 
            color: #155724; 
        }
        .error { 
            background: #f8d7da; 
            border: 2px solid #f5c6cb; 
            color: #721c24; 
        }
        .info { 
            background: #d1ecf1; 
            border: 2px solid #bee5eb; 
            color: #0c5460; 
        }
        small {
            color: #6c757d;
            font-size: 14px;
            margin-top: 5px;
            display: block;
        }
        .progress-bar {
            width: 100%;
            height: 25px;
            background: #e9ecef;
            border-radius: 12px;
            overflow: hidden;
            margin: 15px 0;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #28a745, #20c997);
            width: 0%;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Remover Promoções</h1>
        
        <div class="form-group">
            <label for="mlbId">MLB ID do Anúncio:</label>
            <input type="text" id="mlbId" placeholder="Ex: MLB1234567890" />
            <small>Digite o código MLB do anúncio (encontrado na URL)</small>
        </div>
        
        <div class="form-group">
            <label for="mlbIds">Múltiplos MLB IDs (um por linha):</label>
            <textarea id="mlbIds" rows="6" placeholder="MLB1234567890&#10;MLB0987654321&#10;MLB1122334455"></textarea>
            <small>Para remover promoções de vários anúncios de uma vez</small>
        </div>
        
        <button onclick="removerUnico()">🎯 Remover Único</button>
        <button class="btn-warning" onclick="removerLote()">🚀 Remover em Lote</button>
        <button class="btn-secondary" onclick="verificarStatus()">📊 Status</button>
        <button class="btn-secondary" onclick="limpar()">🧹 Limpar</button>
        
        <div id="resultado"></div>
    </div>

    <script>
        let currentProcessId = null;
        let monitorInterval = null;

        console.log('Script carregado com sucesso!');

        async function removerUnico() {
            console.log('Função removerUnico chamada');
            
            const mlbId = document.getElementById('mlbId').value.trim();
            console.log('MLB ID:', mlbId);
            
            if (!mlbId) {
                alert('Digite um MLB ID');
                return;
            }

            const resultado = document.getElementById('resultado');
            resultado.innerHTML = '<div class="result info">🔄 Removendo promoção...</div>';

            try {
                console.log('Enviando requisição para remover promoção...');
                
                const response = await fetch('/anuncio/remover-promocao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mlb_id: mlbId })
                });

                console.log('Resposta recebida:', response.status);
                
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                
                const data = await response.json();
                console.log('Dados:', data);

                if (data.success) {
                    const metodos = data.metodos_tentados ? data.metodos_tentados.join(', ') : '';
                    const detalhes = data.detalhes_promocao ? data.detalhes_promocao.join(', ') : '';
                    resultado.innerHTML = '<div class="result success">✅ SUCESSO!\n\n' +
                        'Anúncio: ' + (data.titulo || 'N/A') + '\n' +
                        'MLB: ' + data.mlb_id + '\n' +
                        'Status: ' + data.message + '\n' +
                        'Preço antes: R$ ' + (data.preco_antes || 'N/A') + '\n' +
                        'Preço depois: R$ ' + (data.preco_depois || 'N/A') + '\n' +
                        'Ainda tem promoção: ' + (data.ainda_tem_promocao ? 'SIM' : 'NÃO') + '\n' +
                        (metodos ? 'Métodos: ' + metodos + '\n' : '') +
                        (detalhes ? 'Detalhes: ' + detalhes : '') + '</div>';
                } else {
                    resultado.innerHTML = '<div class="result error">❌ ERRO\n\n' +
                        (data.message || data.error) + '\n' +
                        (data.mlb_id ? 'MLB: ' + data.mlb_id : '') + '</div>';
                }
            } catch (error) {
                console.error('Erro na requisição:', error);
                resultado.innerHTML = '<div class="result error">❌ Erro: ' + error.message + '</div>';
            }
        }

        async function removerLote() {
            console.log('Função removerLote chamada');
            
            const mlbIdsText = document.getElementById('mlbIds').value.trim();
            if (!mlbIdsText) {
                alert('Digite os MLB IDs');
                return;
            }

            const mlbIds = mlbIdsText.split('\n').map(id => id.trim()).filter(id => id);
            console.log('MLB IDs para processar:', mlbIds);
            
            const resultado = document.getElementById('resultado');
            resultado.innerHTML = '<div class="result info">🚀 Iniciando remoção em lote...\n' +
                'Total: ' + mlbIds.length + ' anúncios\n\n' +
                '<div class="progress-bar">' +
                    '<div class="progress-fill" id="progressFill">0%</div>' +
                '</div></div>';

            try {
                const response = await fetch('/anuncios/remover-promocoes-lote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mlb_ids: mlbIds, delay_entre_remocoes: 3000 })
                });

                const data = await response.json();
                console.log('Resposta do lote:', data);

                if (data.success) {
                    currentProcessId = data.process_id;
                    monitorarProgresso(data.process_id);
                } else {
                    resultado.innerHTML = '<div class="result error">❌ Erro: ' + data.error + '</div>';
                }
            } catch (error) {
                console.error('Erro no lote:', error);
                resultado.innerHTML = '<div class="result error">❌ Erro: ' + error.message + '</div>';
            }
        }

        async function verificarStatus() {
            console.log('Verificando status para:', currentProcessId);
            
            if (!currentProcessId) {
                alert('Nenhum processamento ativo');
                return;
            }

            try {
                const response = await fetch('/anuncios/status-remocao/' + currentProcessId);
                const data = await response.json();

                const resultado = document.getElementById('resultado');
                const concluido = data.status === 'concluido' ? 
                    '\nConcluído: ' + new Date(data.concluido_em).toLocaleString('pt-BR') : '';
                
                resultado.innerHTML = '<div class="result info">📊 STATUS DO PROCESSAMENTO\n\n' +
                    'Process ID: ' + data.id + '\n' +
                    'Status: ' + data.status + '\n' +
                    'Progresso: ' + data.progresso + '%\n' +
                    'Processados: ' + data.processados + '/' + data.total_anuncios + '\n' +
                    'Sucessos: ' + data.sucessos + '\n' +
                    'Erros: ' + data.erros + '\n' +
                    'Iniciado: ' + new Date(data.iniciado_em).toLocaleString('pt-BR') + concluido + '</div>';
            } catch (error) {
                console.error('Erro ao verificar status:', error);
                document.getElementById('resultado').innerHTML = '<div class="result error">❌ Erro: ' + error.message + '</div>';
            }
        }

        function monitorarProgresso(processId) {
            console.log('Iniciando monitoramento para:', processId);
            
            if (monitorInterval) clearInterval(monitorInterval);
                        
            monitorInterval = setInterval(async () => {
                try {
                    const response = await fetch('/anuncios/status-remocao/' + processId);
                    const data = await response.json();

                    const progressFill = document.getElementById('progressFill');
                    if (progressFill) {
                        progressFill.style.width = data.progresso + '%';
                        progressFill.textContent = data.progresso + '%';
                    }

                    if (data.status === 'concluido' || data.status === 'erro') {
                        console.log('Processamento finalizado:', data.status);
                        clearInterval(monitorInterval);
                        verificarStatus();
                    }
                } catch (error) {
                    console.error('Erro no monitoramento:', error);
                }
            }, 3000);
        }

        function limpar() {
            console.log('Limpando interface');
            
            document.getElementById('resultado').innerHTML = '';
            if (monitorInterval) {
                clearInterval(monitorInterval);
                monitorInterval = null;
            }
            currentProcessId = null;
            document.getElementById('mlbId').value = '';
            document.getElementById('mlbIds').value = '';
        }

        window.addEventListener('load', function() {
            console.log('Página carregada completamente');
            console.log('Funções disponíveis:', {
                removerUnico: typeof removerUnico,
                removerLote: typeof removerLote,
                verificarStatus: typeof verificarStatus,
                limpar: typeof limpar
            });
        });

        window.addEventListener('beforeunload', function() {
            if (monitorInterval) clearInterval(monitorInterval);
        });
    </script>
</body>
</html>`;

  const htmlPath = path.join(__dirname, 'remover-promocao.html');
  
  try {
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    res.send(`
      <h1>✅ Arquivo criado com sucesso!</h1>
      <p>O arquivo <strong>remover-promocao.html</strong> foi criado em:</p>
      <p><code>${htmlPath}</code></p>
      <p><a href="/remover-promocao">🎯 Acessar Interface de Remoção</a></p>
      <p><a href="/">← Voltar ao Dashboard</a></p>
    `);
  } catch (error) {
    res.status(500).send(`
      <h1>❌ Erro ao criar arquivo</h1>
      <p>Erro: ${error.message}</p>
      <p><a href="/">← Voltar ao Dashboard</a></p>
    `);
  }
});

// Endpoint para debug de rotas
app.get('/debug/routes', (req, res) => {
  const routes = [];
  
  app._router.stack.forEach(function(r){
    if (r.route && r.route.path){
      routes.push({
        method: Object.keys(r.route.methods)[0].toUpperCase(),
        path: r.route.path
      });
    }
  });
  
  res.json({
    total_routes: routes.length,
    routes: routes.sort((a, b) => a.path.localeCompare(b.path))
  });
});

// ===== CLASSE CSV MANAGER =====
class PromocaoCSVManager {
  constructor() {
    this.diretorioSaida = CONFIG.diretorio_saida;
    this.arquivoCSV = path.join(this.diretorioSaida, CONFIG.arquivo_csv);
    
    if (!fs.existsSync(this.diretorioSaida)) {
      fs.mkdirSync(this.diretorioSaida, { recursive: true });
    }

    this.headers = [
      'id', 'titulo', 'preco_original', 'preco_promocional', 'desconto_percentual',
      'desconto_valor', 'moeda', 'status', 'condicao', 'categoria', 'vendidos',
      'disponivel', 'tipo_promocao', 'inicio_promocao', 'fim_promocao',
      'link', 'thumbnail', 'criado_em', 'processado_em'
    ];
  }

  escaparCSV(valor) {
    if (valor === null || valor === undefined) return '';
    const str = String(valor).replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  inicializarCSV() {
    const headerLine = this.headers.join(',') + '\n';
    fs.writeFileSync(this.arquivoCSV, '\ufeff' + headerLine, CONFIG.encoding);
    console.log(`✅ Arquivo CSV criado: ${this.arquivoCSV}`);
  }

  adicionarAnuncios(anuncios) {
    const linhas = anuncios.map(anuncio => {
      return [
        this.escaparCSV(anuncio.id),
        this.escaparCSV(anuncio.titulo),
        this.escaparCSV(anuncio.preco_original),
        this.escaparCSV(anuncio.preco_promocional),
        this.escaparCSV(anuncio.desconto_percentual),
        this.escaparCSV(anuncio.desconto_valor),
        this.escaparCSV(anuncio.moeda),
        this.escaparCSV(anuncio.status),
        this.escaparCSV(anuncio.condicao),
        this.escaparCSV(anuncio.categoria),
        this.escaparCSV(anuncio.vendidos),
        this.escaparCSV(anuncio.disponivel),
        this.escaparCSV(anuncio.tipo_promocao),
        this.escaparCSV(anuncio.inicio_promocao),
        this.escaparCSV(anuncio.fim_promocao),
        this.escaparCSV(anuncio.link),
        this.escaparCSV(anuncio.thumbnail),
        this.escaparCSV(anuncio.criado_em),
        this.escaparCSV(new Date().toLocaleString('pt-BR'))
      ].join(',');
    }).join('\n');

    fs.appendFileSync(this.arquivoCSV, linhas + '\n', CONFIG.encoding);
    console.log(`✅ ${anuncios.length} anúncios com promoção adicionados ao CSV`);
  }
}

// Rota POST para autenticação inicial
app.post('/dados', async (req, res) => {
  try {
    const { 
      APP_ID: app_id,
      CLIENT_SECRET: client_secret,
      ML_CODE: code,
      REDIRECT_URI: redirect_uri
    } = process.env;

    if (!app_id || !client_secret || !code || !redirect_uri) {
      throw new Error('Credenciais não configuradas corretamente');
    }

    const url_principal = "https://api.mercadolibre.com/oauth/token";

    const headers = {
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded"
    };

    const dados = `grant_type=authorization_code&client_id=${app_id}&client_secret=${client_secret}&code=${code}&redirect_uri=${redirect_uri}`;

    const resposta = await fetch(url_principal, {
      method: 'POST',
      headers: headers,
      body: dados
    });

    if (!resposta.ok) {
      const errorData = await resposta.json();
      throw new Error(`Erro na API: ${errorData.message || 'Erro desconhecido'}`);
    }

    const resposta_json = await resposta.json();
    
    console.log('Resposta da API:', resposta_json);

    res.json({
      success: true,
      data: resposta_json
    });

  } catch (error) {
    console.error('Erro na requisição:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📋 Endpoints disponíveis:`);
  console.log(`   • http://localhost:${PORT}/ - Dashboard principal`);
  console.log(`   • http://localhost:${PORT}/remover-promocao - Interface de remoção`);
  console.log(`   • http://localhost:${PORT}/test-token - Testar token`);
  console.log(`🔧 Certifique-se de configurar seu ACCESS_TOKEN no arquivo .env`);
});