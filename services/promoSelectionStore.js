// services/promoSelectionStore.js
const crypto = require('crypto');
const IORedis = require('ioredis');

const TTL_SECONDS = Number(process.env.PROMO_SELECTION_TTL_SECONDS || 15 * 60);

function makeRedis() {
  if (process.env.REDIS_URL) {
    return new IORedis(process.env.REDIS_URL, { lazyConnect: false });
  }
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  const pass = process.env.REDIS_PASSWORD || null;
  return new IORedis({ host, port, password: pass, lazyConnect: false });
}

const redis = makeRedis();

function keySel(token)   { return `promo:sel:${token}`; }
function keyMeta(token)  { return `promo:sel:${token}:meta`; }

function genToken() { return crypto.randomBytes(16).toString('hex'); }

async function saveSelection({ accountKey, data, total }) {
  const token = genToken();
  const payload = { accountKey, data, created_at: Date.now() };
  await redis.set(keySel(token), JSON.stringify(payload), 'EX', TTL_SECONDS);
  await redis.set(keyMeta(token), JSON.stringify({ total }), 'EX', TTL_SECONDS);
  return { token, total };
}

async function getSelection(token) {
  const raw = await redis.get(keySel(token));
  if (!raw) return null;
  return JSON.parse(raw);
}

async function getMeta(token) {
  const raw = await redis.get(keyMeta(token));
  return raw ? JSON.parse(raw) : {};
}

async function updateMeta(token, patch) {
  const meta = { ...(await getMeta(token)), ...(patch || {}) };
  await redis.set(keyMeta(token), JSON.stringify(meta), 'EX', TTL_SECONDS);
  return meta;
}

async function destroy(token) {
  await redis.del(keySel(token));
  await redis.del(keyMeta(token));
}

module.exports = {
  saveSelection,
  getSelection,
  getMeta,
  updateMeta,
  destroy,
};
