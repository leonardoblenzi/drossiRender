// pesquisaDescricaoRoutes.js
const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const path = require('path');
const fs = require('fs').promises;

// ========== Middleware de log ==========
router.use((req, res, next) => {
  req.startTime = Date.now();
  console.log(`📡 ${req.method} ${req.originalUrl} - ${new Date().toISOString()}`);
  res.on('finish', () => {
    const ms = Date.now() - req.startTime;
    console.log(`✅ ${req.method} ${req.originalUrl} - ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ========== Helpers ==========
function ensureFunction(obj, fnName) {
  if (!obj || typeof obj[fnName] !== 'function') {
    const msg = `queueService.${fnName} não está implementado. Ajuste o queueService ou renomeie a chamada nesta rota.`;
    const err = new Error(msg);
    err.status = 501;
    throw err;
  }
}

function validateJobId(jobId) {
  // Permite letras, números, hífen e sublinhado. Ajuste se seus IDs tiverem outro padrão.
  const ok = /^[A-Za-z0-9_-]+$/.test(jobId);
  if (!ok) {
    const err = new Error('Parâmetro job_id inválido. Use apenas letras, números, hífen e sublinhado.');
    err.status = 400;
    throw err;
  }
}

async function getResultDir(jobId) {
  // Preferência: queueService.getResultDir(jobId)
  if (queueService && typeof queueService.getResultDir === 'function') {
    const p = await queueService.getResultDir(jobId);
    if (p) return p;
  }
  // Fallback opinativo (ajuste para o seu projeto):
  // data/pesquisa-descricao/<jobId>
  return path.join(process.cwd(), 'data', 'pesquisa-descricao', jobId);
}

// ========== HEALTH E STATUS ==========
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'pesquisa-descricao',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

router.get('/status', async (req, res, next) => {
  try {
    if (queueService && typeof queueService.stats === 'function') {
      const stats = await queueService.stats();
      return res.json({ ok: true, stats });
    }
    return res.status(200).json({
      ok: true,
      note: 'queueService.stats não implementado; retornando status básico.',
      uptime: process.uptime()
    });
  } catch (err) {
    next(err);
  }
});

// ========== ENFILEIRAMENTO / PROCESSAMENTO ==========
/**
 * POST /enfileirar
 * Body esperado (exemplo):
 * {
 *   "consultas": ["texto 1", "texto 2"],
 *   "opcoes": { "lingua": "pt-BR" }
 * }
 */
router.post('/enfileirar', async (req, res, next) => {
  try {
    const body = req.body || {};
    const consultas = Array.isArray(body.consultas) ? body.consultas : [];
    const opcoes = body.opcoes || {};

    if (!consultas.length) {
      const err = new Error('Campo "consultas" deve ser um array não vazio.');
      err.status = 400;
      throw err;
    }

    ensureFunction(queueService, 'enqueuePesquisaDescricao');
    const job = await queueService.enqueuePesquisaDescricao({ consultas, opcoes });

    return res.status(202).json({
      ok: true,
      message: 'Job enfileirado com sucesso.',
      job_id: job.id || job.jobId || job, // tolerante a diferentes libs
    });
  } catch (err) {
    next(err);
  }
});

// ========== CONSULTA DE JOB ==========
router.get('/jobs/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    validateJobId(job_id);

    ensureFunction(queueService, 'getJob');
    const job = await queueService.getJob(job_id);

    if (!job) {
      return res.status(404).json({ ok: false, message: 'Job não encontrado.' });
    }

    // Tolerância a diferentes formas de expor status/resultado
    const status = job.status || job.state || job.progress || 'desconhecido';
    const result = job.result || job.returnvalue || null;
    const failedReason = job.failedReason || job.reason || null;

    return res.json({
      ok: true,
      job_id,
      status,
      failedReason,
      result
    });
  } catch (err) {
    next(err);
  }
});

// Lista básica de jobs (ajuste se tiver suporte no seu queueService)
router.get('/jobs', async (req, res, next) => {
  try {
    if (queueService && typeof queueService.listJobs === 'function') {
      const { status } = req.query; // opcional
      const jobs = await queueService.listJobs({ status });
      return res.json({ ok: true, count: Array.isArray(jobs) ? jobs.length : 0, jobs });
    }
    return res.status(200).json({
      ok: true,
      note: 'queueService.listJobs não implementado.'
    });
  } catch (err) {
    next(err);
  }
});

// ========== CONTROLE ==========
router.post('/cancelar/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    validateJobId(job_id);

    ensureFunction(queueService, 'cancelJob');
    const out = await queueService.cancelJob(job_id);
    return res.json({ ok: true, message: 'Job cancelado (ou tentativa realizada).', data: out });
  } catch (err) {
    next(err);
  }
});

router.post('/reprocessar/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    validateJobId(job_id);

    // Tente "reprocessar" ou "retryFailed" dependendo de como seu service chama
    const fn = typeof queueService.reprocessar === 'function'
      ? 'reprocessar'
      : (typeof queueService.retryFailed === 'function' ? 'retryFailed' : null);

    if (!fn) {
      const e = new Error('queueService.reprocessar (ou retryFailed) não implementado.');
      e.status = 501;
      throw e;
    }

    const out = await queueService[fn](job_id);
    return res.json({ ok: true, message: 'Reprocessamento acionado.', data: out });
  } catch (err) {
    next(err);
  }
});

router.post('/pausar', async (req, res, next) => {
  try {
    const fn = typeof queueService.pause === 'function'
      ? 'pause'
      : (typeof queueService.pausar === 'function' ? 'pausar' : null);

    if (!fn) {
      const e = new Error('queueService.pause (ou pausar) não implementado.');
      e.status = 501;
      throw e;
    }

    const out = await queueService[fn]();
    return res.json({ ok: true, message: 'Sistema pausado.', data: out });
  } catch (err) {
    next(err);
  }
});

router.post('/retomar', async (req, res, next) => {
  try {
    const fn = typeof queueService.resume === 'function'
      ? 'resume'
      : (typeof queueService.retomar === 'function' ? 'retomar' : null);

    if (!fn) {
      const e = new Error('queueService.resume (ou retomar) não implementado.');
      e.status = 501;
      throw e;
    }

    const out = await queueService[fn]();
    return res.json({ ok: true, message: 'Sistema retomado.', data: out });
  } catch (err) {
    next(err);
  }
});

// ========== DOWNLOAD ==========
router.get('/download/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    validateJobId(job_id);

    const dir = await getResultDir(job_id);

    // Lista arquivos disponíveis para download
    let files;
    try {
      files = await fs.readdir(dir);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return res.status(404).json({ ok: false, message: 'Resultados não encontrados para este job.' });
      }
      throw e;
    }

    if (!files.length) {
      return res.status(404).json({ ok: false, message: 'Nenhum arquivo encontrado para este job.' });
    }

    // Se houver um único arquivo, já envia direto
    if (files.length === 1) {
      const filePath = path.join(dir, files[0]);
      return res.download(filePath, files[0]);
    }

    // Senão, retorna lista para o cliente escolher via /download/:job_id/:filename
    return res.json({
      ok: true,
      message: 'Vários arquivos disponíveis. Baixe usando /download/:job_id/:filename.',
      files
    });
  } catch (err) {
    next(err);
  }
});

router.get('/download/:job_id/:filename', async (req, res, next) => {
  try {
    const { job_id, filename } = req.params;
    validateJobId(job_id);

    // Proteção básica contra path traversal
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
      const e = new Error('Nome de arquivo inválido.');
      e.status = 400;
      throw e;
    }

    const dir = await getResultDir(job_id);
    const filePath = path.join(dir, filename);

    try {
      await fs.access(filePath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return res.status(404).json({ ok: false, message: 'Arquivo não encontrado para este job.' });
      }
      throw e;
    }

    return res.download(filePath, filename);
  } catch (err) {
    next(err);
  }
});

// ========== HELP / MAPA DE ROTAS ==========
router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'pesquisa-descricao',
    endpoints: {
      health: ['GET /health', 'GET /status'],
      processamento: ['POST /enfileirar', 'GET /jobs', 'GET /jobs/:job_id'],
      controle: [
        'POST /cancelar/:job_id - Cancelar job',
        'POST /reprocessar/:job_id - Reprocessar erros',
        'POST /pausar - Pausar sistema',
        'POST /retomar - Retomar sistema'
      ],
      download: [
        'GET /download/:job_id - Download de resultados (direto se 1 arquivo, senão lista)',
        'GET /download/:job_id/:filename - Download de arquivo específico'
      ]
    }
  });
});

// ========== Handler de Erros ==========
router.use((err, req, res, next) => {
  const status = err.status || 500;
  const payload = {
    ok: false,
    message: err.message || 'Erro interno do servidor.',
  };
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
  }
  res.status(status).json(payload);
});

module.exports = router;