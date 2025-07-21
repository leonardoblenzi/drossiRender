const PesquisaDescricaoService = require('../services/pesquisaDescricaoService');
const { v4: uuidv4 } = require('uuid');

// Armazenar processamentos em memória (em produção, usar Redis ou BD)
const processamentosPesquisa = {};

class PesquisaDescricaoController {
  
  // Pesquisar texto em lista de MLBs
  static async pesquisarTexto(req, res) {
    try {
      const { mlb_ids, texto_pesquisa, processar_em_lote = false, analise_detalhada = true } = req.body;

      // Validações
      if (!mlb_ids || !Array.isArray(mlb_ids) || mlb_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Lista de MLB IDs é obrigatória e deve ser um array não vazio'
        });
      }

      if (!texto_pesquisa || texto_pesquisa.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Texto de pesquisa é obrigatório'
        });
      }

      // Limpar e validar MLBs
      const mlbsLimpos = mlb_ids
        .map(mlb => mlb.toString().trim())
        .filter(mlb => mlb.length > 0)
        .filter(mlb => mlb.startsWith('MLB'));

      if (mlbsLimpos.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum MLB ID válido encontrado (devem começar com "MLB")'
        });
      }

      console.log(`🔍 Pesquisando "${texto_pesquisa}" em ${mlbsLimpos.length} MLBs...`);

      // Se for processamento em lote (para muitos MLBs)
      if (processar_em_lote || mlbsLimpos.length > 10) {
        const processId = uuidv4();
        
        processamentosPesquisa[processId] = {
          id: processId,
          status: 'iniciado',
          criado_em: new Date(),
          total_mlbs: mlbsLimpos.length,
          texto_pesquisado: texto_pesquisa,
          analise_detalhada: analise_detalhada,
          resultados: null,
          erro: null
        };

        // Processar em background
        PesquisaDescricaoService.processarPesquisaLote(
          processId, 
          mlbsLimpos, 
          texto_pesquisa, 
          processamentosPesquisa
        ).catch(error => {
          console.error('❌ Erro no processamento em lote:', error);
          processamentosPesquisa[processId].status = 'erro';
          processamentosPesquisa[processId].erro = error.message;
        });

        return res.json({
          success: true,
          message: 'Processamento iniciado em background',
          process_id: processId,
          total_mlbs: mlbsLimpos.length,
          status_url: `/api/pesquisa-descricao/status/${processId}`
        });
      }

      // Processamento direto (para poucos MLBs)
      const resultado = await PesquisaDescricaoService.pesquisarTextoEmDescricoes(
        mlbsLimpos, 
        texto_pesquisa
      );

      if (resultado.success) {
        // Adicionar análise de relevância para cada item encontrado
        resultado.resultados.mlbs_com_texto.forEach(item => {
          if (item.analise_detalhada) {
            item.relevancia = PesquisaDescricaoService.analisarRelevancia(
              item.analise_detalhada, 
              texto_pesquisa
            );
          }
        });

        res.json({
          success: true,
          message: 'Pesquisa detalhada concluída com sucesso',
          ...resultado.resultados
        });
      } else {
        res.status(500).json(resultado);
      }

    } catch (error) {
      console.error('❌ Erro no controller de pesquisa:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  }

  // Consultar status do processamento em lote
  static async consultarStatus(req, res) {
    try {
      const { processId } = req.params;

      if (!processamentosPesquisa[processId]) {
        return res.status(404).json({
          success: false,
          message: 'Processamento não encontrado'
        });
      }

      const status = processamentosPesquisa[processId];

      res.json({
        success: true,
        process_id: processId,
        status: status.status,
        criado_em: status.criado_em,
        concluido_em: status.concluido_em,
        total_mlbs: status.total_mlbs,
        texto_pesquisado: status.texto_pesquisado,
        analise_detalhada: status.analise_detalhada,
        resultados: status.resultados,
        erro: status.erro
      });

    } catch (error) {
      console.error('❌ Erro ao consultar status:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  }

  // Listar todos os processamentos
  static async listarProcessamentos(req, res) {
    try {
      const processamentos = Object.values(processamentosPesquisa)
        .map(p => ({
          id: p.id,
          status: p.status,
          criado_em: p.criado_em,
          concluido_em: p.concluido_em,
          total_mlbs: p.total_mlbs,
          texto_pesquisado: p.texto_pesquisado,
          analise_detalhada: p.analise_detalhada,
          tem_resultados: !!p.resultados
        }))
        .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));

      res.json({
        success: true,
        total_processamentos: processamentos.length,
        processamentos: processamentos
      });

    } catch (error) {
      console.error('❌ Erro ao listar processamentos:', error.message);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  }
}

module.exports = PesquisaDescricaoController;