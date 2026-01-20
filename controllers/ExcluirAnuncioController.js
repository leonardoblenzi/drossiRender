// controllers/ExcluirAnuncioController.js
"use strict";

const ExclusaoService = require("../services/excluirAnuncioService");

// Armazenamento simples de status por processo (fluxo legado / em memória)
const processosExclusao = {};

/**
 * DELETE /anuncios/excluir/:mlb_id
 * Usa o excluirAnuncioService.excluirUnico, que:
 *  - fecha o anúncio (status=closed) se necessário
 *  - envia deleted=true
 *  - retorna log detalhado (steps, status_inicial, etc.)
 *
 * ✅ ATUALIZAÇÃO:
 * - Agora passa { req, res } pro service conseguir usar:
 *   • req.ml.accessToken (authMiddleware)
 *   • res.locals.accountKey/mlCreds (ensureAccount)
 *   • app.get("getAccessTokenForAccount") (ml-auth adapter)
 */
class ExcluirAnuncioController {
  static async excluirUnico(req, res) {
    try {
      // agora pegamos do params, mas ainda aceitamos body como fallback
      const mlbId = String(req.params.mlb_id || req.body.mlb_id || "")
        .trim()
        .toUpperCase();

      if (!mlbId || !/^MLB\d{5,}$/.test(mlbId)) {
        return res.status(400).json({
          success: false,
          error: "MLB ID é obrigatório e deve ser válido (ex: MLB123456789).",
        });
      }

      // ✅ passa contexto do pipeline novo (token/conta)
      const resultado = await ExclusaoService.excluirUnico(mlbId, { req, res });

      // se quiser, podemos usar o success pra escolher o status HTTP
      const statusCode = resultado.success ? 200 : 400;
      return res.status(statusCode).json(resultado);
    } catch (err) {
      console.error("[ERRO excluirUnico]", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Erro interno ao excluir anúncio",
      });
    }
  }

  /**
   * POST /anuncios/excluir-lote
   * Body: { mlb_ids: [...], delay_entre_remocoes?: number }
   * Dispara processamento assíncrono em memória usando ExclusaoService.excluirLote.
   *
   * ✅ ATUALIZAÇÃO:
   * - Agora passa options com req/res para resolver token por conta selecionada.
   */
  static async excluirLote(req, res) {
    try {
      const { mlb_ids, delay_entre_remocoes = 2500 } = req.body;

      if (!Array.isArray(mlb_ids) || mlb_ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Informe uma lista de MLB IDs em "mlb_ids".',
        });
      }

      const processId = Date.now().toString();
      processosExclusao[processId] = {
        id: processId,
        status: "iniciando",
        total_anuncios: mlb_ids.length,
        processados: 0,
        sucessos: 0,
        erros: 0,
        progresso: 0,
        iniciado_em: new Date(),
        resultados: [],
      };

      // ✅ prepara options com contexto do pipeline novo
      const options = {
        req,
        res,
        accessToken: req?.ml?.accessToken || null,
        accountKey: res?.locals?.accountKey || null,
        mlCreds: res?.locals?.mlCreds || null,
        getAccessTokenForAccount: req?.app?.get("getAccessTokenForAccount"),
      };

      // responde imediatamente pro front
      res.json({
        success: true,
        message: "Processamento de exclusão em lote iniciado.",
        process_id: processId,
        total_ids: mlb_ids.length,
      });

      // dispara o processamento em segundo plano (não await)
      ExclusaoService.excluirLote(
        mlb_ids,
        processId,
        processosExclusao[processId],
        delay_entre_remocoes,
        options,
      ).catch((err) => {
        console.error("[ERRO excluirLote async]", err);
        const proc = processosExclusao[processId];
        if (proc) {
          proc.status = "erro";
          proc.erro = err.message;
        }
      });
    } catch (err) {
      console.error("[ERRO excluirLote]", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Erro interno ao iniciar exclusão em lote",
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
      return res.status(404).json({
        success: false,
        error: "Processo não encontrado",
        id: req.params.id,
      });
    }
    return res.json(proc);
  }
}

module.exports = ExcluirAnuncioController;
