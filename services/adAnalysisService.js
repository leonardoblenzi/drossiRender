// services/adAnalysisService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

// -------- helpers de ambiente/urls --------
function urls() {
  return {
    users_me:      (config?.urls?.users_me) || 'https://api.mercadolibre.com/users/me',
    items_base:    (config?.urls?.items)    || 'https://api.mercadolibre.com/items',
    orders_search: (config?.urls?.orders_search) || 'https://api.mercadolibre.com/orders/search',
  };
}

const TZ = 'America/Sao_Paulo';

// formata ISO → "dd/MM/yyyy HH:mm" em pt-BR
function formatPtBr(dateIso) {
  if (!dateIso) return '—';
  try {
    const d = new Date(dateIso);
    return d.toLocaleString('pt-BR', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return '—'; }
}

// diferença humana (ex.: "3d 4h", "2h 15m", "0m")
function humanSince(dateIso) {
  if (!dateIso) return '—';
  const now = Date.now();
  const then = new Date(dateIso).getTime();
  let diff = Math.max(0, now - then);

  const day = 24*60*60*1000;
  const hour = 60*60*1000;
  const min = 60*1000;

  const d = Math.floor(diff / day); diff -= d*day;
  const h = Math.floor(diff / hour); diff -= h*hour;
  const m = Math.floor(diff / min);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// mapping listing_type_id → rótulo
function mapListingTypeId(id) {
  const map = {
    gold_pro: 'Premium',
    gold_premium: 'Premium',
    gold_special: 'Clássico',
    gold: 'Clássico',
    classic: 'Clássico',
    free: 'Grátis',
  };
  return map[id] || 'Outro';
}

// -------- auth helpers (reuso de token no lote) --------
async function prepararAuthState(options = {}) {
  // se vier token pronto/state, só retorna
  if (options?.token && options?.creds) return options;

  // tenta pegar token válido (res.locals.mlCreds pode ter vindo no options)
  const token = await TokenService.renovarTokenSeNecessario(options?.mlCreds || {});
  return { token, creds: options?.mlCreds || {}, key: (options?.accountKey || options?.key || 'conta') };
}

async function authFetch(url, init, state) {
  const call = async (tok) => {
    const headers = { ...(init?.headers || {}), Authorization: `Bearer ${tok}` };
    return fetch(url, { ...init, headers });
  };
  let r = await call(state.token);
  if (r.status !== 401) return r;

  // 401 → renova e tenta novamente
  const renewed = await TokenService.renovarToken(state.creds);
  state.token = renewed.access_token;
  return call(state.token);
}

// -------- núcleo do serviço --------
class AdAnalysisService {
  /**
   * Analisa 1 MLB: última venda (orders), tipo de anúncio (item).
   * Só considera itens da conta selecionada (seller === /users/me.id).
   */
  static async analisarUm(mlbId, options = {}) {
    const U = urls();
    const state = await prepararAuthState(options);
    const log = (options.logger || console).log;

    try {
      const baseHeaders = { 'Content-Type': 'application/json' };

      // 1) pega /users/me (id do seller atual)
      const rMe = await authFetch(U.users_me, { method: 'GET', headers: baseHeaders }, state);
      if (!rMe.ok) throw new Error(`users/me falhou: HTTP ${rMe.status}`);
      const me = await rMe.json();

      // 2) pega item
      const rItem = await authFetch(`${U.items_base}/${mlbId}`, { method: 'GET', headers: baseHeaders }, state);
      if (!rItem.ok) {
        const msg = rItem.status === 404 ? 'Item não encontrado' : `Erro ao buscar item: HTTP ${rItem.status}`;
        return { success: false, mlb: mlbId, status: 'ERRO', message: msg };
      }
      const item = await rItem.json();

      // garante pertencimento
      if (item.seller_id !== me.id) {
        return {
          success: false,
          mlb: mlbId,
          status: 'FORA_DA_CONTA',
          message: 'Este anúncio não pertence à conta selecionada.'
        };
      }

      // 3) busca a ÚLTIMA venda (orders/search) LIMIT 1, sort desc
      const q = new URLSearchParams({
        seller: String(me.id),
        item: String(mlbId),
        sort: 'date_desc',
        limit: '1',
      });
      const rOrders = await authFetch(`${U.orders_search}?${q.toString()}`, { method: 'GET', headers: baseHeaders }, state);
      if (!rOrders.ok) {
        // se der 404/400 tratamos como "sem vendas"
        log?.(`[${state.key}] orders/search falhou: HTTP ${rOrders.status}`);
      }
      const ordersPayload = rOrders.ok ? await rOrders.json() : null;

      // a API pode retornar em "results" ou "orders" dependendo do stack
      const arr = Array.isArray(ordersPayload?.results)
        ? ordersPayload.results
        : (Array.isArray(ordersPayload?.orders) ? ordersPayload.orders : []);

      // mantém somente vendas de fato (status pagos)
      // (se porventura a API não aceitar query por status, filtramos aqui)
      const ordered = arr
        .filter(o => ['paid', 'confirmed', 'partially_paid'].includes(String(o?.status || '').toLowerCase()))
        .sort((a, b) => new Date(b.date_closed || b.date_created || 0) - new Date(a.date_closed || a.date_created || 0));

      const lastOrder = ordered[0];
      const lastDateIso = lastOrder
        ? (lastOrder.date_closed || lastOrder.date_created || lastOrder.date_last_updated)
        : null;

      const tipoLabel = mapListingTypeId(item.listing_type_id);

      return {
        success: true,
        mlb: mlbId,
        status: 'OK',
        // tipo do anúncio
        tipo: tipoLabel,
        tipo_raw: item.listing_type_id || null,
        // última venda
        ultima_venda: lastDateIso,
        ultima_venda_fmt: formatPtBr(lastDateIso),
        tempo_desde_ultima_venda: humanSince(lastDateIso),
      };
    } catch (err) {
      return {
        success: false,
        mlb: mlbId,
        status: 'ERRO',
        message: err?.message || String(err),
      };
    }
  }

  /**
   * Lote – reusa um token; só renova no 401.
   * Retorna array de resultados na mesma ordem dos MLBs.
   */
  static async analisarLote(mlbIds = [], delayMs = 300, options = {}) {
    const state = await prepararAuthState(options);
    const resultados = [];

    for (let i = 0; i < mlbIds.length; i++) {
      const id = String(mlbIds[i] || '').trim();
      if (!id) continue;

      const r = await this.analisarUm(id, state);
      resultados.push(r);

      if (delayMs && i < mlbIds.length - 1) {
        await new Promise(r => setTimeout(r, Number(delayMs) || 0));
      }
    }
    return resultados;
  }
}

module.exports = AdAnalysisService;
