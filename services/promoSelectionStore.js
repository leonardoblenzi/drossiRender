// services/promoSelectionStore.js
// Store simples em memória para seleções de promoções (pode ser trocado por Redis depois)

const crypto = require('crypto');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

const _selections = new Map();

/**
 * Cria um token e salva a seleção na memória.
 *
 * @param {Object} params
 * @param {string} params.accountKey
 * @param {string} params.promotionId
 * @param {string} params.promotionType
 * @param {Object} params.filters   // { status, mlb, percent_max, ... }
 * @param {string[]} params.items   // array de MLBs
 */
function createSelection({ accountKey, promotionId, promotionType, filters, items }) {
  const token = crypto.randomBytes(16).toString('hex');

  const arr = Array.isArray(items) ? [...items] : [];

  const record = {
    token,
    accountKey: accountKey || null,
    promotionId: String(promotionId || ''),
    promotionType: String(promotionType || ''),
    filters: filters || {},
    items: arr,
    total: arr.length,              // 👈 campo novo
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  };

  _selections.set(token, record);
  return record;
}

/**
 * Recupera uma seleção por token, opcionalmente validando a conta.
 */
function getSelection(token, { accountKey } = {}) {
  const rec = _selections.get(String(token || ''));
  if (!rec) return null;

  // expirada
  if (rec.expiresAt && rec.expiresAt < Date.now()) {
    _selections.delete(token);
    return null;
  }

  if (accountKey && rec.accountKey && rec.accountKey !== accountKey) {
    // seleção de outra conta → não retorna
    return null;
  }

  return rec;
}

/**
 * Atualiza o TTL (p. ex. quando um job começa a rodar).
 */
function touch(token, extraMs = DEFAULT_TTL_MS) {
  const rec = _selections.get(String(token || ''));
  if (!rec) return;
  rec.expiresAt = Date.now() + extraMs;
}

/**
 * Remove uma seleção explicitamente.
 */
function remove(token) {
  _selections.delete(String(token || ''));
}

/**
 * Limpa seleções expiradas (pode ser chamado em interval).
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [tk, rec] of _selections.entries()) {
    if (rec.expiresAt && rec.expiresAt < now) {
      _selections.delete(tk);
    }
  }
}

module.exports = {
  createSelection,
  getSelection,
  touch,
  remove,
  cleanupExpired,
};
