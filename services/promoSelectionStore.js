// services/promoSelectionStore.js
const crypto = require('crypto');
const IORedis = require('ioredis');

const TTL_SECONDS = Number(process.env.PROMO_SELECTION_TTL_SECONDS || 15 * 60);

function makeRedis() {
  if (process.env.REDIS_URL) {
    // Suporta redis:// e rediss://
    return makeRedis();
  }
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD || undefined;
  return makeRedis();
}

const redis = makeRedis();
redis.on('error', (e) => {
  console.error('[PromoSelectionStore] Redis error:', e?.message || e);
});

function keySel(token)  { return `promo:sel:${token}`; }
function keyMeta(token) { return `promo:sel:${token}:meta`; }

function genToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 chars
}

function safeParse(jsonStr, fallback = null) {
  try { return JSON.parse(jsonStr); } catch { return fallback; }
}

/**
 * Salva uma seleção e devolve { token, total }.
 * Armazena:
 *  - keySel(token): { accountKey, data, created_at, v }
 *  - keyMeta(token): { total }
 */
async function saveSelection({ accountKey, data, total }) {
  const token = genToken();
  const payload = { accountKey: accountKey ?? null, data: data ?? {}, created_at: Date.now(), v: 1 };
  const meta = { total: Number(total || 0) };

  // MULTI para garantir atomicidade
  const m = redis.multi();
  m.set(keySel(token), JSON.stringify(payload), 'EX', TTL_SECONDS);
  m.set(keyMeta(token), JSON.stringify(meta), 'EX', TTL_SECONDS);
  await m.exec();

  return { token, total: meta.total };
}

async function getSelection(token) {
  const raw = await redis.get(keySel(token));
  if (!raw) return null;
  return safeParse(raw, null);
}

async function getMeta(token) {
  const raw = await redis.get(keyMeta(token));
  return raw ? safeParse(raw, {}) : {};
}

/** Faz merge em meta e renova TTL. */
async function updateMeta(token, patch) {
  const cur = await getMeta(token);
  const meta = { ...(cur || {}), ...(patch || {}) };
  await redis.set(keyMeta(token), JSON.stringify(meta), 'EX', TTL_SECONDS);
  return meta;
}

/** Renova TTL das chaves da seleção (útil durante um fluxo longo). */
async function touch(token) {
  const k1 = keySel(token);
  const k2 = keyMeta(token);
  // Usa PEXPIRE para não precisar reler valores
  const m = redis.multi();
  m.expire(k1, TTL_SECONDS);
  m.expire(k2, TTL_SECONDS);
  await m.exec();
}

/** Apaga a seleção. */
async function destroy(token) {
  await redis.del(keySel(token), keyMeta(token));
}

/** Encerramento limpo (útil em testes) */
async function close() {
  try { await redis.quit(); } catch { /* noop */ }
}

module.exports = {
  saveSelection,
  getSelection,
  getMeta,
  updateMeta,
  touch,
  destroy,
  close,
};
