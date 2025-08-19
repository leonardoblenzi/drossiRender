// pesquisaDescricaoRoutes.js (ATUALIZADO)
// - Mantém todas as rotas atuais
// - Adiciona geração de TXT on-the-fly a partir do JSONL de resultados
//   * Suporte por query: ?formato=txt ou ?format=txt ou ?txt=1
//   * Suporte por arquivo: /download/:job_id/:filename (quando filename termina com .txt)
// - Respostas seguem o padrão { ok: true/false }

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

async function findResultadosJsonl(dir, jobId) {
  // Prioriza <jobId>_resultados.jsonl
  const preferido = path.join(dir, `${jobId}_resultados.jsonl`);
  try {
    await fs.access(preferido);
    return preferido;
  } catch {}

  // Caso não exista, tenta qualquer *_resultados.jsonl
  try {
    const files = await fs.readdir(dir);
    const candidato = files.find((f) => f.endsWith('_resultados.jsonl'));
    if (candidato) return path.join(dir, candidato);
  } catch {}
  return null;
}

function linhaToTxt(jsonLine) {
  try {
    const r = JSON.parse(jsonLine);
    const det = r?.deteccao_dois_volumes || {};
    // volumes: "02" se detectado, "00" caso contrário
    const volumes = det.detectado ? '02' : '00';
    const padrao  = det.padrao_detectado || '';
    const trecho  = (det.trecho_detectado || '').toString().replace(/\s+/g, ' ').trim();
    const encontrado = r.encontrado ? 'SIM' : 'NAO';
    const mlb = r.mlb || r.mlb_id || r.id || '';
    return `${mlb};${encontrado};${volumes};${padrao};${trecho}`;
  } catch {
    return '';
  }
}

async function gerarTxtDeResultados(dir, jobId) {
  const jsonlPath = await findResultadosJsonl(dir, jobId);
  if (!jsonlPath) {
    const e = new Error('Arquivo de resultados (.jsonl) não encontrado.');
    e.status = 404;
    throw e;
  }
  const raw = await fs.readFile(jsonlPath, 'utf8');
  const linhas = raw.split(/\r?\n/).filter(Boolean);
  const corpo = linhas.map(linhaToTxt).filter(Boolean);
  return ['MLB;ENCONTRADO;VOLUMES;PADRAO;TRECHO', ...corpo].join('\n');
}

function querTxt(req) {
  const q = req.query || {};
  const val = (q.formato || q.format || '').toString().toLowerCase();
  if (val === 'txt') return true;
  if (q.txt === '1' || q.txt === 1 || q.txt === true || q.txt === 'true') return true;
  return false;
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
// GET /download/:job_id — auto-download do resultados
// Suporta TXT via query (?formato=txt | ?format=txt | ?txt=1)
router.get('/download/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    validateJobId(job_id);

    const dir = await getResultDir(job_id);

    // Se pedirem TXT por query, gera on-the-fly
    if (querTxt(req)) {
      try {
        const txt = await gerarTxtDeResultados(dir, job_id);
        const name = `${job_id}_resultados.txt`;
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(txt);
      } catch (e) {
        if (e.status === 404) {
          return res.status(404).json({ ok: false, message: e.message });
        }
        throw e;
      }
    }

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

    // Se houver apenas 1 arquivo, baixa ele
    if (files.length === 1) {
      const filePath = path.join(dir, files[0]);
      return res.download(filePath, files[0]);
    }

    // Se houver vários, tenta baixar automaticamente o *_resultados.jsonl
    const resultadosFile = files.find(f => f.endsWith('_resultados.jsonl'));
    if (resultadosFile) {
      const filePath = path.join(dir, resultadosFile);
      return res.download(filePath, resultadosFile);
    }

    // Caso não ache o resultados.jsonl, cai de volta para a listagem
    return res.json({
      ok: true,
      message: 'Vários arquivos disponíveis. Baixe usando /download/:job_id/:filename.',
      files
    });
  } catch (err) {
    next(err);
  }
});

// GET /download/:job_id/:filename — download de arquivo específico
// Se :filename terminar com .txt e esse arquivo não existir, geramos a partir do JSONL
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

    // Se pediram .txt e o arquivo ainda não existe, gera do JSONL
    if (filename.toLowerCase().endsWith('.txt')) {
      try {
        // Tenta acessar direto o arquivo .txt, caso já exista em disco
        await fs.access(filePath);
        return res.download(filePath, filename);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        // Gera on-the-fly
        const txt = await gerarTxtDeResultados(dir, job_id);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(txt);
      }
    }

    // Caso contrário, tenta baixar o arquivo solicitado
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
        'GET /download/:job_id - Download de resultados (direto se 1 arquivo, senão lista; suporta ?formato=txt)',
        'GET /download/:job_id/:filename - Download de arquivo específico (se .txt, gera do JSONL)'
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
