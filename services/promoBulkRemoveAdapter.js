// services/promoBulkRemoveAdapter.js
// Adapter fino para remoção em massa usando o seu services/promocaoService.js
// - Gerencia o "registro" de processos em memória
// - Dispara o processarRemocaoLote() sem bloquear a requisição
// - Expõe helpers para listar e consultar status

const PromocaoService = require('./promocaoService');

// Registro in-memory dos processos (similar ao que você já usa em pesquisa-descricao)
const processos = Object.create(null);

// id curto, legível, sem dependências
function genId(prefix = 'premove') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Normaliza/filtra a lista de MLBs
function sanitizeIds(ids) {
  const a = Array.isArray(ids) ? ids : [];
  const set = new Set(
    a.map(String)
     .map(s => s.trim().toUpperCase())
     .filter(s => s && /^MLB\d+$/.test(s))
  );
  return Array.from(set);
}

// Cria o objeto de status esperado por PromocaoService.processarRemocaoLote()
function makeStatusSkeleton(id, mlbIds, meta = {}) {
  return {
    id,
    type: 'REMOVE',                   // tipo do job
    status: 'queued',                 // queued | processando | concluido | erro
    criado_em: new Date(),
    concluido_em: null,

    // progresso
    total_anuncios: mlbIds.length,
    processados: 0,
    sucessos: 0,
    erros: 0,
    progresso: 0,

    // resultados detalhados por item (o próprio service preenche)
    resultados: [],

    // metadados úteis na UI
    meta
  };
}

/**
 * Dispara um job de remoção em massa.
 * Não bloqueia a request; o processamento roda em background.
 *
 * @param {Object} opts
 *  - mlbIds: string[]
 *  - delayMs?: number (padrão 250ms)
 *  - mlCreds?: qualquer (vem de res.locals.mlCreds)
 *  - accountKey?: string (vem de res.locals.accountKey)
 *  - logger?: console-like
 */
async function startRemoveJob(opts = {}) {
  const {
    mlbIds = [],
    delayMs = 250,
    mlCreds = {},
    accountKey = null,
    logger = console
  } = opts;

  const ids = sanitizeIds(mlbIds);
  if (!ids.length) {
    throw new Error('Nenhum MLB válido informado para remoção.');
  }

  const jobId = genId();
  const status = makeStatusSkeleton(jobId, ids, { accountKey, delayMs });
  processos[jobId] = status;

  // dispara em background
  setImmediate(async () => {
    try {
      await PromocaoService.processarRemocaoLote(
        jobId,
        ids,
        Number(delayMs) || 0,
        processos,                     // <- o service atualiza processos[jobId]
        { mlCreds, accountKey, logger }
      );
    } catch (err) {
      status.status = 'erro';
      status.progresso = Math.round((status.processados / status.total_anuncios) * 100);
      status.resultados.push({
        success: false,
        message: err?.message || String(err),
        error: true
      });
      status.concluido_em = new Date();
      logger.error('❌ Erro no job de remoção:', err);
    }
  });

  return processos[jobId];
}

/** Detalhe completo do job */
function jobDetail(jobId) {
  return processos[jobId] || null;
}

/** Lista recente (resumo), ordenada por criação desc */
function listRecent(limit = 10) {
  const rows = Object.values(processos)
    .sort((a, b) => b.criado_em - a.criado_em)
    .slice(0, limit)
    .map(j => ({
      id: j.id,
      type: j.type,
      status: j.status,
      criado_em: j.criado_em,
      concluido_em: j.concluido_em || null,
      total_anuncios: j.total_anuncios,
      processados: j.processados,
      sucessos: j.sucessos,
      erros: j.erros,
      progresso: j.progresso,
      meta: j.meta || {}
    }));

  return rows;
}

module.exports = {
  startRemoveJob,
  jobDetail,
  listRecent,

  // exporta o store para debug/inspeção se quiser
  _store: processos
};
