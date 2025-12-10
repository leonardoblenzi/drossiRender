// controllers/ExcluirAnuncioController.js
const ExclusaoService = require('../services/excluirAnuncioService');

// Armazenamento simples de status por processo (fluxo legado / em memória)
const processosExclusao = {};

/**
 * DELETE /anuncios/excluir/:mlb_id
 * Usa o excluirAnuncioService.excluirUnico, que:
 *  - fecha o anúncio (status=closed) se necessário
 *  - envia deleted=true
 *  - retorna log detalhado (steps, status_inicial, etc.)
 */
class ExcluirAnuncioController {
  static async excluirUnico(req, res) {
    try {
      // agora pegamos do params, mas ainda aceitamos body como fallback
      const mlbId = (req.params.mlb_id || req.body.mlb_id || '').trim().toUpperCase();

      if (!mlbId || !/^MLB\d{5,}$/.test(mlbId)) {
        return res
          .status(400)
          .json({ success: false, error: 'MLB ID é obrigatório e deve ser válido (ex: MLB123456789).' });
      }

      const resultado = await ExclusaoService.excluirUnico(mlbId);

      // se quiser, podemos usar o success pra escolher o status HTTP
      const statusCode = resultado.success ? 200 : 400;
      return res.status(statusCode).json(resultado);
    } catch (err) {
      console.error('[ERRO excluirUnico]', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno ao excluir anúncio',
      });
    }
  }

  /**
   * POST /anuncios/excluir-lote
   * Body: { mlb_ids: [...], delay_entre_remocoes?: number }
   * Dispara processamento assíncrono em memória usando ExclusaoService.excluirLote.
   */
  static async excluirLote(req, res) {
    try {
      const { mlb_ids, delay_entre_remocoes = 2500 } = req.body;

      if (!Array.isArray(mlb_ids) || mlb_ids.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Informe uma lista de MLB IDs em "mlb_ids".' });
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
        resultados: [],
      };

      // responde imediatamente pro front
      res.json({
        success: true,
        message: 'Processamento de exclusão em lote iniciado.',
        process_id: processId,
      });

      // dispara o processamento em segundo plano (não await)
      ExclusaoService.excluirLote(
        mlb_ids,
        processId,
        processosExclusao[processId],
        delay_entre_remocoes
      ).catch((err) => {
        console.error('[ERRO excluirLote async]', err);
        const proc = processosExclusao[processId];
        if (proc) {
          proc.status = 'erro';
          proc.erro = err.message;
        }
      });
    } catch (err) {
      console.error('[ERRO excluirLote]', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Erro interno ao iniciar exclusão em lote',
      });
    }
  }

  /**
   * GET /anuncios/status-exclusao/:id
   * Retorna o snapshot do processo em memória.
   */
  static async status(req, res) {
    const proc = processosExclusao[req.params.id];
    if (!proc) {
      return res
        .status(404)
        .json({ success: false, error: 'Processo não encontrado', id: req.params.id });
    }
    return res.json(proc);
  }
}

module.exports = ExcluirAnuncioController;
