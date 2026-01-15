"use strict";

const Bull = require("bull");
const { makeRedis } = require("../lib/redisClient");
const {
  updatePrazoProducao,
  normMlb,
  clampInt,
} = require("./prazoProducaoService");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const queue = new Bull("prazo-producao-queue", makeRedis());

// job.data: { accessToken, mlb_ids, days, delayMs }
queue.process(async (job) => {
  const startedAt = Date.now();

  const accessToken = job.data?.accessToken;
  const days = clampInt(job.data?.days, 0, 365);
  const delayMs = clampInt(job.data?.delayMs, 0, 10000) ?? 250;

  const raw = Array.isArray(job.data?.mlb_ids) ? job.data.mlb_ids : [];
  const items = raw.map(normMlb).filter(Boolean);

  const total = items.length || 0;
  let ok = 0;
  let err = 0;

  // meta pro status
  await job.updateProgress(0);
  await job.log(`Iniciado: total=${total}, days=${days}, delayMs=${delayMs}`);

  const results = []; // se quiser manter (cuidado com tamanho)

  for (let i = 0; i < items.length; i++) {
    const mlbId = items[i];

    try {
      await updatePrazoProducao({
        accessToken,
        mlbId,
        days,
        verify: true,
      });
      ok++;
      results.push({ mlb_id: mlbId, success: true });
    } catch (e) {
      err++;
      results.push({
        mlb_id: mlbId,
        success: false,
        error: e?.message || "erro",
      });
    }

    const processed = i + 1;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 100;

    // salva contadores no job (pra status endpoint ler)
    job.data.__meta = {
      total,
      processed,
      ok,
      err,
      startedAt,
      updatedAt: Date.now(),
    };

    await job.update(job.data);
    await job.updateProgress(pct);

    if (delayMs > 0 && processed < total) await sleep(delayMs);
  }

  job.data.__meta = {
    total,
    processed: total,
    ok,
    err,
    startedAt,
    finishedAt: Date.now(),
  };
  await job.update(job.data);
  await job.updateProgress(100);

  return {
    ok,
    err,
    total,
    results,
  };
});

async function enqueuePrazoJob({ accessToken, mlb_ids, days, delayMs }) {
  const job = await queue.add(
    { accessToken, mlb_ids, days, delayMs },
    {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    }
  );
  return String(job.id);
}

async function getPrazoJobStatus(jobId) {
  const job = await queue.getJob(String(jobId));
  if (!job) return null;

  const state = await job.getState(); // completed/failed/active/waiting/delayed
  const progress = Number(job._progress ?? 0);

  const meta = job.data?.__meta || {};
  const total = meta.total ?? job.data?.mlb_ids?.length ?? 0;
  const processed = meta.processed ?? 0;

  const status =
    state === "completed"
      ? "concluido"
      : state === "failed"
      ? "erro"
      : "processando";

  const iniciado_em = meta.startedAt
    ? new Date(meta.startedAt).toISOString()
    : null;
  const concluido_em =
    status === "concluido" && meta.finishedAt
      ? new Date(meta.finishedAt).toISOString()
      : null;

  return {
    id: String(job.id),
    status,
    progresso: Math.max(0, Math.min(100, Math.round(progress))),
    total_anuncios: total,
    processados: processed,
    sucessos: meta.ok ?? 0,
    erros: meta.err ?? 0,
    iniciado_em,
    concluido_em,
  };
}

module.exports = {
  enqueuePrazoJob,
  getPrazoJobStatus,
};
