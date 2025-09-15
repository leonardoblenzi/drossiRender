// lib/redisClient.js
const IORedis = require('ioredis');

function makeRedis() {
  const common = { maxRetriesPerRequest: null, enableReadyCheck: false };
  const url = process.env.REDIS_URL;
  if (url) return new IORedis(url, common);
  return new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    ...common,
  });
}

module.exports = { makeRedis };
