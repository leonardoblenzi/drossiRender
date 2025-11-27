// services/validarDimensoesService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

// URLs base
function urls() {
  return {
    items_base: (config?.urls?.items) || 'https://api.mercadolibre.com/items',
  };
}

// ===== Helpers de auth reutilizáveis (mesmo padrão do adAnalysisService) =====
async function prepararAuthState(options = {}) {
  if (options?.token && options?.creds) return options;
  const token = await TokenService.renovarTokenSeNecessario(options?.mlCreds || {});
  return {
    token,
    creds: options?.mlCreds || {},
    key: options?.accountKey || options?.key || 'conta',
  };
}

async function authFetch(url, init, state) {
  const call = async (tok) => {
    const headers = { ...(init?.headers || {}), Authorization: `Bearer ${tok}` };
    return fetch(url, { ...init, headers });
  };

  let r = await call(state.token);
  if (r.status !== 401) return r;

  const renewed = await TokenService.renovarToken(state.creds);
  state.token = renewed.access_token;
  return call(state.token);
}

// ===== parse dimensions "9x19x19,500" =====
function parseDimensions(dimStr) {
  if (!dimStr || typeof dimStr !== 'string') {
    return {
      height_cm: null,
      width_cm: null,
      length_cm: null,
      weight_g: null,
    };
  }
  const [dimsPart, weightPart] = dimStr.split(',');
  const dims = (dimsPart || '')
    .split('x')
    .map((p) => p.trim())
    .map((p) => Number(p.replace(',', '.')) || null);

  const [h, w, l] = dims;
  const weight = weightPart ? Number(weightPart.replace(',', '.')) || null : null;

  return {
    height_cm: h,
    width_cm: w,
    length_cm: l,
    weight_g: weight,
  };
}

class ValidarDimensoesService {
  /**
   * Busca as dimensões de um item (MLB) e devolve:
   * { mlb, raw, height_cm, width_cm, length_cm, weight_g }
   */
  static async analisarUm(mlbId, options = {}) {
    const U = urls();
    const state = await prepararAuthState(options);
    const log = (options.logger && options.logger.log)
  ? options.logger.log.bind(options.logger)
  : console.log.bind(console);


    try {
      const baseHeaders = { 'Content-Type': 'application/json' };
      const rItem = await authFetch(
        `${U.items_base}/${encodeURIComponent(mlbId)}`,
        { method: 'GET', headers: baseHeaders },
        state,
      );

      if (!rItem.ok) {
        const msg =
          rItem.status === 404
            ? 'Item não encontrado'
            : `Erro ao buscar item: HTTP ${rItem.status}`;
        return {
          mlb: mlbId,
          success: false,
          status: 'ERRO',
          message: msg,
          raw: null,
          height_cm: null,
          width_cm: null,
          length_cm: null,
          weight_g: null,
        };
      }

      const item = await rItem.json();
      const raw = item?.shipping?.dimensions || null;
      const parsed = parseDimensions(raw);

      return {
        mlb: mlbId,
        success: true,
        status: 'OK',
        raw,
        ...parsed,
      };
    } catch (err) {
      log?.(`[${state.key}] validarDimensoes.analisarUm erro`, err);
      return {
        mlb: mlbId,
        success: false,
        status: 'ERRO',
        message: err?.message || String(err),
        raw: null,
        height_cm: null,
        width_cm: null,
        length_cm: null,
        weight_g: null,
      };
    }
  }
}

module.exports = ValidarDimensoesService;
