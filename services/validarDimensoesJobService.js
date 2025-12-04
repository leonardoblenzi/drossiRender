// services/validarDimensoesJobService.js
const path = require('path');
const fs = require('fs');
const Queue = require('bull');

const ValidarDimensoesService = require('./validarDimensoesService');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'validar-dimensoes');

// garante que a pasta exista
function ensureStorageDir() {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('❌ Erro ao criar pasta de storage validar-dimensoes:', err);
  }
}

// configura conexão Redis igual ao resto do projeto
function getRedisConfig() {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

let queueInstance = null;
let workerStarted = false;

function getQueue() {
  if (!queueInstance) {
    queueInstance = new Queue('validar-dimensoes', {
      redis: getRedisConfig(),
    });
  }
  return queueInstance;
}

/**
 * Gera CSV a partir da lista de resultados do ValidarDimensoesService.analisarUm
 */
function gerarCsv(resultados) {
  const header = [
    'MLB',
    'Altura_cm',
    'Largura_cm',
    'Comprimento_cm',
    'Peso_g',
    'Bruto_shipping_dimensions',
    'Status',
    'Mensagem',
  ];

  const linhas = resultados.map((r) => {
    const status = r.success ? 'OK' : (r.status || 'ERRO');
    const msg = r.success ? '' : (r.message || '');
    const cols = [
      r.mlb || '',
      r.height_cm ?? '',
      r.width_cm ?? '',
      r.length_cm ?? '',
      r.weight_g ?? '',
      r.raw || '',
      status,
      msg,
    ];

    return cols
      .map((v) => {
        const s = String(v ?? '');
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(';');
  });

  return [header.join(';'), ...linhas].join('\n');
}

/**
 * Worker que processa 1 job (lista de MLBs) e devolve info + caminho do CSV
 */
async function processJob(job) {
  const { mlbs = [], accountKey, mlCreds } = job.data || {};
  const total = mlbs.length;

  if (!Array.isArray(mlbs) || mlbs.length === 0) {
    return {
      success: false,
      total: 0,
      fileName: null,
      filePath: null,
      message: 'Nenhum MLB informado no job.',
    };
  }

  console.log(`📦 [validar-dimensoes] Iniciando job ${job.id} com ${total} MLBs (${accountKey || 'sem conta'})`);

  const resultados = [];
  const opts = { mlCreds, accountKey: accountKey || 'conta' };

  for (let i = 0; i < mlbs.length; i++) {
    const mlb = String(mlbs[i] || '').trim();
    if (!mlb) continue;

    try {
      const r = await ValidarDimensoesService.analisarUm(mlb, opts);
      resultados.push(r);
    } catch (err) {
      resultados.push({
        mlb,
        success: false,
        status: 'ERRO',
        message: err?.message || String(err),
        raw: null,
        height_cm: null,
        width_cm: null,
        length_cm: null,
        weight_g: null,
      });
    }

    // atualiza progresso a cada 10 itens ou no último
    if (i === total - 1 || i % 10 === 0) {
      const pct = Math.round(((i + 1) / total) * 100);
      await job.progress(pct);
    }
  }

  // gera CSV e salva em disco
  ensureStorageDir();
  const fileName = `dimensoes-mlb-${job.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = path.join(STORAGE_DIR, fileName);
  const csv = gerarCsv(resultados);

  fs.writeFileSync(filePath, csv, 'utf8');

  console.log(`✅ [validar-dimensoes] Job ${job.id} concluído. CSV gerado em ${filePath}`);

  return {
    success: true,
    total,
    fileName,
    // guardamos o path RELATIVO pra não vazar estrutura interna
    filePathRelative: path.relative(path.join(__dirname, '..'), filePath),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Inicia o worker (chamar 1x, por exemplo no primeiro require do controller)
 */
function iniciarWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const queue = getQueue();
  queue.process(async (job) => {
    try {
      return await processJob(job);
    } catch (err) {
      console.error('❌ [validar-dimensoes] Erro no worker:', err);
      throw err;
    }
  });

  queue.on('failed', (job, err) => {
    console.error(`❌ [validar-dimensoes] Job ${job.id} falhou:`, err?.message || err);
  });

  queue.on('completed', (job) => {
    console.log(`🎉 [validar-dimensoes] Job ${job.id} finalizado (100%)`);
  });

  console.log('🚀 Worker de validar-dimensoes iniciado');
}

/**
 * Cria 1 job para processar lista de MLBS em background
 */
async function criarJob(mlbs = [], { accountKey, mlCreds } = {}) {
  const queue = getQueue();
  const job = await queue.add(
    {
      mlbs,
      accountKey: accountKey || 'conta',
      mlCreds: mlCreds || {},
    },
    {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  );

  return {
    success: true,
    jobId: job.id,
  };
}

/**
 * Lista jobs recentes (simples – pode ajustar limites se quiser)
 */
async function listarJobs(limit = 50) {
  const queue = getQueue();

  const [waiting, active, completed, failed] = await Promise.all([
    queue.getJobs(['waiting'], 0, limit),
    queue.getJobs(['active'], 0, limit),
    queue.getJobs(['completed'], 0, limit),
    queue.getJobs(['failed'], 0, limit),
  ]);

  function mapJob(j, status) {
    return {
      id: j.id,
      status,
      progress: j._progress || 0,
      data: {
        total_mlbs: (j.data?.mlbs || []).length,
        accountKey: j.data?.accountKey || null,
      },
      timestamp: j.timestamp,
      finishedOn: j.finishedOn || null,
      failedReason: j.failedReason || null,
    };
  }

  return [
    ...waiting.map((j) => mapJob(j, 'waiting')),
    ...active.map((j) => mapJob(j, 'active')),
    ...completed.map((j) => mapJob(j, 'completed')),
    ...failed.map((j) => mapJob(j, 'failed')),
  ];
}

/**
 * Status de 1 job específico
 */
async function obterStatus(jobId) {
  const queue = getQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job._progress || 0;
  const totalMlbs = (job.data?.mlbs || []).length;

  return {
    id: job.id,
    state,
    progress,
    total_mlbs: totalMlbs,
    data: {
      accountKey: job.data?.accountKey || null,
    },
    result: job.returnvalue || null,
  };
}

/**
 * Caminho absoluto do CSV de um job (se já tiver concluído)
 */
function resolverCaminhoCsv(returnvalue) {
  if (!returnvalue || !returnvalue.filePathRelative) return null;
  const root = path.join(__dirname, '..');
  return path.join(root, returnvalue.filePathRelative);
}

async function obterCaminhoCsv(jobId) {
  const queue = getQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  if (state !== 'completed') return null;

  const rv = job.returnvalue || {};
  return {
    fullPath: resolverCaminhoCsv(rv),
    fileName: rv.fileName || `dimensoes-mlb-${job.id}.csv`,
  };
}

module.exports = {
  iniciarWorker,
  criarJob,
  listarJobs,
  obterStatus,
  obterCaminhoCsv,
};
