// controllers/ExcluirAnuncioController.js
const ExclusaoService = require('../services/excluirAnuncioService');

// Armazenamento de status por processo (para o lote e status-exclusao)
const processosExclusao = {};

class ExcluirAnuncioController {
  // DELETE /anuncios/excluir/:mlb_id
  static async excluirUnico(req, res) {
    try {
      const mlbId = req.params.mlb_id || req.body.mlb_id;
      if (!mlbId) {
        return res.status(400).json({ success: false, error: 'MLB ID é obrigatório' });
      }

      const resultado = await ExclusaoService.excluirUnico(mlbId);
      // Já devolvemos o objeto “cru” do service
      return res.json(resultado);
    } catch (err) {
      console.error('[ERRO excluirUnico]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /anuncios/excluir-lote
  static async excluirLote(req, res) {
    try {
      const { mlb_ids, delay_entre_remocoes = 2500 } = req.body;

      if (!Array.isArray(mlb_ids) || mlb_ids.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Informe uma lista de MLB IDs' });
      }

      const processId = Date.now().toString();

      processosExclusao[processId] = {
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

      // responde já pro front
      res.json({
        success: true,
        message: 'Processamento iniciado',
        process_id: processId
      });

      // roda em background
      ExclusaoService.excluirLote(
        mlb_ids,
        processId,
        processosExclusao[processId],
        delay_entre_remocoes
      );
    } catch (err) {
      console.error('[ERRO excluirLote]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /anuncios/status-exclusao/:id
  static async status(req, res) {
    const processo = processosExclusao[req.params.id];
    if (!processo) {
      return res
        .status(404)
        .json({ success: false, error: 'Processo não encontrado' });
    }
    return res.json(processo);
  }
}

module.exports = ExcluirAnuncioController;
