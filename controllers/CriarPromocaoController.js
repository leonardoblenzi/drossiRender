const CriarPromocaoService = require('../services/criarPromocaoService');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CriarPromocaoController {
    constructor() {
        // Armazenar processamentos em andamento (igual ao seu sistema de remoção)
        this.processamentosCriacao = {};
    }


// Consultar campanhas disponíveis para um item específico
async consultarCampanhasItem(req, res) {
  try {
    const { itemId } = req.params;
    
    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: 'ID do item é obrigatório'
      });
    }

    console.log(`🔍 Consultando campanhas disponíveis para item: ${itemId}`);
    
    const resultado = await CriarPromocaoService.consultarCampanhasItem(itemId);
    
    if (resultado.success) {
      res.json({
        success: true,
        message: 'Campanhas do item consultadas com sucesso',
        data: resultado
      });
    } else {
      res.status(400).json({
        success: false,
        message: resultado.message,
        error: resultado.error
      });
    }

  } catch (error) {
    console.error(`❌ Erro ao consultar campanhas do item:`, error.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao consultar campanhas do item',
      error: error.message
    });
  }
}


// Consultar promoções disponíveis para o usuário
async consultarPromocoes(req, res) {
  try {
    console.log('🔍 Consultando promoções disponíveis...');
    
    const resultado = await CriarPromocaoService.consultarPromocoesDisponiveis();
    
    // Log detalhado para debug
    console.log('📋 Resultado da consulta:', JSON.stringify(resultado, null, 2));
    
    if (resultado.success) {
      res.json({
        success: true,
        message: 'Promoções consultadas com sucesso',
        data: resultado
      });
    } else {
      res.status(400).json({
        success: false,
        message: resultado.message,
        error: resultado.error,
        debug: resultado.debug_info
      });
    }
  } catch (error) {
    console.error('❌ Erro no controller consultarPromocoes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
}

    // Substitua a função consultarItem no controller
async consultarItem(req, res) {
  try {
    const { itemId } = req.params;
    
    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: 'ID do item é obrigatório'
      });
    }

    console.log(`🔍 Consultando item: ${itemId}`);
    
    const resultado = await CriarPromocaoService.consultarItem(itemId);
    
    if (resultado.success) {
      res.json({
        success: true,
        data: {
          item: resultado.item,
          promocoes_ativas: resultado.promocoes_detalhadas.participacoes_ativas,
          campanhas_disponiveis: resultado.promocoes_detalhadas.campanhas_disponiveis,
          promocoes_automaticas: resultado.promocoes_detalhadas.promocoes_automaticas,
          tem_promocao_ativa: resultado.tem_promocao_realmente_ativa,
          pode_criar_promocao: resultado.pode_criar_promocao,
          elegivel_para_promocao: resultado.item.status === 'active' && resultado.item.price > 0,
          resumo: resultado.resumo_promocoes
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: resultado.message
      });
    }

  } catch (error) {
    console.error(`❌ Erro ao consultar item:`, error.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao consultar item',
      error: error.message
    });
  }
}

    // Criar promoção individual
    async criarPromocaoIndividual(req, res) {
        try {
            const { itemId } = req.params;
            const dadosPromocao = req.body;
            
            if (!itemId) {
                return res.status(400).json({
                    success: false,
                    message: 'ID do item é obrigatório'
                });
            }

            // Validar dados obrigatórios
            if (!dadosPromocao.tipo) {
                return res.status(400).json({
                    success: false,
                    message: 'Tipo de promoção é obrigatório'
                });
            }

            if (!dadosPromocao.preco_promocional && !dadosPromocao.percentual_desconto) {
                return res.status(400).json({
                    success: false,
                    message: 'Informe o preço promocional ou percentual de desconto'
                });
            }

            console.log(`🎯 Criando promoção individual para item: ${itemId}`);
            console.log(`📋 Dados da promoção:`, dadosPromocao);
            
            const resultado = await CriarPromocaoService.criarPromocaoUnico(itemId, dadosPromocao);
            
            if (resultado.success) {
                res.json({
                    success: true,
                    message: 'Promoção criada com sucesso',
                    data: resultado
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: resultado.message,
                    data: resultado
                });
            }

        } catch (error) {
            console.error(`❌ Erro ao criar promoção individual:`, error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao criar promoção',
                error: error.message
            });
        }
    }

    // Criar promoções em massa via CSV
    async criarPromocoesMassa(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Arquivo CSV é obrigatório'
                });
            }

            const { delay = 3000 } = req.body;
            const processId = uuidv4();
            
            console.log(`🚀 Iniciando processamento em massa: ${processId}`);
            console.log(`📁 Arquivo: ${req.file.filename}`);
            
            // Ler e processar CSV
            const itensPromocao = [];
            const csvPath = req.file.path;
            
            return new Promise((resolve, reject) => {
                fs.createReadStream(csvPath)
                    .pipe(csv())
                    .on('data', (row) => {
                        // Processar cada linha do CSV
                        const item = {
                            mlb_id: row.mlb_id || row.MLB_ID || row.id,
                            tipo: row.tipo || row.TIPO || 'PRICE_DISCOUNT',
                            preco_promocional: row.preco_promocional || row.PRECO_PROMOCIONAL,
                            percentual_desconto: row.percentual_desconto || row.PERCENTUAL_DESCONTO,
                            data_inicio: row.data_inicio || row.DATA_INICIO,
                            data_fim: row.data_fim || row.DATA_FIM
                        };
                        
                        if (item.mlb_id) {
                            itensPromocao.push(item);
                        }
                    })
                    .on('end', async () => {
                        console.log(`📋 Itens processados do CSV: ${itensPromocao.length}`);
                        
                        if (itensPromocao.length === 0) {
                            return res.status(400).json({
                                success: false,
                                message: 'Nenhum item válido encontrado no CSV'
                            });
                        }

                        // Inicializar status do processamento
                        this.processamentosCriacao[processId] = {
                            id: processId,
                            status: 'iniciado',
                            total_anuncios: itensPromocao.length,
                            processados: 0,
                            sucessos: 0,
                            erros: 0,
                            progresso: 0,
                            iniciado_em: new Date(),
                            concluido_em: null,
                            resultados: []
                        };

                        // Responder imediatamente com o ID do processo
                        res.json({
                            success: true,
                            message: 'Processamento iniciado',
                            process_id: processId,
                            total_itens: itensPromocao.length,
                            status_url: `/api/criar-promocao/status/${processId}`
                        });

                        // Processar em background
                        CriarPromocaoService.processarCriacaoLote(
                            processId, 
                            itensPromocao, 
                            parseInt(delay), 
                            this.processamentosCriacao
                        ).catch(error => {
                            console.error('❌ Erro no processamento em lote:', error);
                            this.processamentosCriacao[processId].status = 'erro';
                            this.processamentosCriacao[processId].erro = error.message;
                        });

                        // Limpar arquivo após processamento
                        setTimeout(() => {
                            fs.unlink(csvPath, (err) => {
                                if (err) console.error('❌ Erro ao deletar arquivo:', err);
                                else console.log('🗑️ Arquivo CSV temporário removido');
                            });
                        }, 60000); // 1 minuto
                    })
                    .on('error', (error) => {
                        console.error('❌ Erro ao processar CSV:', error);
                        res.status(500).json({
                            success: false,
                            message: 'Erro ao processar arquivo CSV',
                            error: error.message
                        });
                    });
            });

        } catch (error) {
            console.error(`❌ Erro ao processar arquivo CSV:`, error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao processar arquivo',
                error: error.message
            });
        }
    }

    // Consultar status do processamento em massa
    async consultarStatusProcessamento(req, res) {
        try {
            const { processId } = req.params;
            
            if (!processId || !this.processamentosCriacao[processId]) {
                return res.status(404).json({
                    success: false,
                    message: 'Processamento não encontrado'
                });
            }

            const status = this.processamentosCriacao[processId];
            
            res.json({
                success: true,
                data: status
            });

        } catch (error) {
            console.error(`❌ Erro ao consultar status:`, error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao consultar status',
                error: error.message
            });
        }
    }

    // Listar todos os processamentos
    async listarProcessamentos(req, res) {
        try {
            const processamentos = Object.values(this.processamentosCriacao)
                .sort((a, b) => new Date(b.iniciado_em) - new Date(a.iniciado_em))
                .slice(0, 20); // Últimos 20 processamentos

            res.json({
                success: true,
                data: processamentos,
                total: processamentos.length
            });

        } catch (error) {
            console.error(`❌ Erro ao listar processamentos:`, error.message);
            res.status(500).json({
                success: false,
                message: 'Erro ao listar processamentos',
                error: error.message
            });
        }
    }

    // Endpoint de teste
    async testarConexao(req, res) {
        try {
            const TokenService = require('../services/tokenService');
            const config = require('../config/config');
            
            const access_token = await TokenService.renovarTokenSeNecessario();
            const headers = {
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json"
            };

            const userResponse = await fetch(config.urls.users_me, { headers });
            const userData = await userResponse.json();

            res.json({
                success: true,
                message: 'Conexão com API do Mercado Livre funcionando',
                timestamp: new Date().toISOString(),
                user: {
                    id: userData.id,
                    nickname: userData.nickname,
                    email: userData.email
                }
            });

        } catch (error) {
            console.error(`❌ Erro no teste de conexão:`, error.message);
            res.status(500).json({
                success: false,
                message: 'Erro na conexão com API',
                error: error.message
            });
        }
    }
}

module.exports = new CriarPromocaoController();