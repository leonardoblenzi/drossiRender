// controllers/JardinagemController.js
const JardinagemService = require("../services/jardinagemService");

// Armazenamento simples de status por processo (fluxo legado / em memória)
const processosJardinagem = {};

/**
 * MODOS:
 * - CLOSE_RELIST       (encerra e relista)
 * - PAUSE_RELIST       (pausa e relista / tenta relist)
 * - ONLY_CLOSE         (só finaliza em lote, sem recriar)
 * - ONLY_PAUSE         (só pausa)
 * - CLONE_NEW_CLOSE_OLD (SOMENTE unitário: clona (novo) e fecha o antigo)
 */
class JardinagemController {
  static _normMlb(v) {
    return String(v || "")
      .trim()
      .toUpperCase();
  }

  static _isValidMlb(mlb) {
    return /^MLB\d{5,}$/.test(mlb);
  }

  static _normMode(v) {
    return String(v || "")
      .trim()
      .toUpperCase();
  }

  static _allowedModes() {
    return new Set([
      "CLOSE_RELIST",
      "PAUSE_RELIST",
      "ONLY_CLOSE",
      "ONLY_PAUSE",
      "CLONE_NEW_CLOSE_OLD",
    ]);
  }

  static _allowedBulkModes() {
    // no lote, você disse que NÃO tem clone
    return new Set([
      "CLOSE_RELIST",
      "PAUSE_RELIST",
      "ONLY_CLOSE",
      "ONLY_PAUSE",
    ]);
  }

  static _pickCloneOverrides(body) {
    const src = body?.clone_overrides;
    if (!src || typeof src !== "object") return null;

    const out = {};

    // price: number >= 0
    if (
      src.price !== undefined &&
      src.price !== null &&
      String(src.price).trim() !== ""
    ) {
      const n = Number(String(src.price).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        const err = new Error("clone_overrides.price inválido (ex.: 199.90).");
        err.statusCode = 400;
        throw err;
      }
      out.price = n;
    }

    // quantity: int >= 0
    if (
      src.quantity !== undefined &&
      src.quantity !== null &&
      String(src.quantity).trim() !== ""
    ) {
      const q = Number(src.quantity);
      if (!Number.isFinite(q) || !Number.isInteger(q) || q < 0) {
        const err = new Error(
          "clone_overrides.quantity inválido (inteiro >= 0)."
        );
        err.statusCode = 400;
        throw err;
      }
      out.quantity = q;
    }

    // title: string
    if (src.title !== undefined && src.title !== null) {
      const t = String(src.title).trim();
      if (t) out.title = t;
    }

    return Object.keys(out).length ? out : null;
  }

  /**
   * POST /api/jardinagem/item
   * Body:
   *  { mlb, mode, clone_overrides? }
   */
  static async single(req, res) {
    try {
      const mlb = JardinagemController._normMlb(
        req.body?.mlb || req.body?.mlb_id || req.params?.mlb
      );
      const mode = JardinagemController._normMode(req.body?.mode);

      if (!mlb || !JardinagemController._isValidMlb(mlb)) {
        return res.status(400).json({
          ok: false,
          success: false,
          error: "MLB é obrigatório e deve ser válido (ex: MLB123456789).",
        });
      }

      if (!mode || !JardinagemController._allowedModes().has(mode)) {
        return res.status(400).json({
          ok: false,
          success: false,
          error:
            "mode inválido. Use: CLOSE_RELIST | PAUSE_RELIST | ONLY_CLOSE | ONLY_PAUSE | CLONE_NEW_CLOSE_OLD",
        });
      }

      // clone_overrides só faz sentido no clone
      let clone_overrides = null;
      if (mode === "CLONE_NEW_CLOSE_OLD") {
        clone_overrides = JardinagemController._pickCloneOverrides(req.body);
      }

      const resultado = await JardinagemService.processSingle({
        mlb,
        mode,
        clone_overrides,
        // se você precisar do token do ML aqui, o service pode pegar via authFetch do seu projeto;
        // ou você pode passar algo como req.ml.accessToken se o seu service for puro.
        req,
      });

      const ok = resultado?.ok ?? resultado?.success ?? true;
      const statusCode = ok ? 200 : 400;
      return res.status(statusCode).json(resultado);
    } catch (err) {
      console.error("[ERRO jardinagem single]", err);
      const status = err.statusCode || 500;
      return res.status(status).json({
        ok: false,
        success: false,
        error: err.message || "Erro interno ao executar Jardinagem (unitário)",
      });
    }
  }

  /**
   * POST /api/jardinagem/lote
   * Body: { mlbs: [...], mode, delay_ms?: number }
   * Dispara processamento assíncrono em memória usando JardinagemService.processBulk.
   */
  static async bulk(req, res) {
    try {
      const rawList = req.body?.mlbs || req.body?.mlb_ids || [];
      const mode = JardinagemController._normMode(req.body?.mode);
      const delayMs = Number.isFinite(Number(req.body?.delay_ms))
        ? Number(req.body.delay_ms)
        : 250;

      if (!Array.isArray(rawList) || rawList.length === 0) {
        return res.status(400).json({
          ok: false,
          success: false,
          error: 'Informe uma lista de MLBs em "mlbs".',
        });
      }

      if (!mode || !JardinagemController._allowedBulkModes().has(mode)) {
        return res.status(400).json({
          ok: false,
          success: false,
          error:
            "mode inválido para lote. Use: CLOSE_RELIST | PAUSE_RELIST | ONLY_CLOSE | ONLY_PAUSE (CLONE_NEW_CLOSE_OLD é só unitário).",
        });
      }

      const mlbs = Array.from(
        new Set(
          rawList
            .map(JardinagemController._normMlb)
            .filter((m) => JardinagemController._isValidMlb(m))
        )
      );

      if (!mlbs.length) {
        return res.status(400).json({
          ok: false,
          success: false,
          error: "Nenhum MLB válido encontrado na lista.",
        });
      }

      const processId = Date.now().toString();
      processosJardinagem[processId] = {
        id: processId,
        status: "iniciando",
        mode,
        total: mlbs.length,
        processados: 0,
        sucessos: 0,
        erros: 0,
        progresso: 0,
        iniciado_em: new Date(),
        resultados: [],
      };

      // responde imediatamente pro front
      res.json({
        ok: true,
        success: true,
        message: "Processamento de Jardinagem em lote iniciado.",
        process_id: processId,
      });

      // dispara o processamento em "segundo plano" (não await)
      JardinagemService.processBulk({
        mlbs,
        mode,
        processId,
        procRef: processosJardinagem[processId],
        delayMs,
        req,
      }).catch((err) => {
        console.error("[ERRO jardinagem bulk async]", err);
        const proc = processosJardinagem[processId];
        if (proc) {
          proc.status = "erro";
          proc.erro = err.message;
        }
      });
    } catch (err) {
      console.error("[ERRO jardinagem bulk]", err);
      return res.status(500).json({
        ok: false,
        success: false,
        error: err.message || "Erro interno ao iniciar Jardinagem em lote",
      });
    }
  }

  /**
   * GET /api/jardinagem/status/:id
   * Retorna o snapshot do processo em memória.
   */
  static async status(req, res) {
    const proc = processosJardinagem[req.params.id];
    if (!proc) {
      return res.status(404).json({
        ok: false,
        success: false,
        error: "Processo não encontrado",
        id: req.params.id,
      });
    }
    return res.json(proc);
  }
}

module.exports = JardinagemController;
