// services/productAdsService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

const SITE_ID = 'MLB';
const ITEMS_URL = 'https://api.mercadolibre.com/items';

function urls() {
  return {
    // Lista de advertisers do usuário para Product Ads
    advertisers:
      'https://api.mercadolibre.com/advertising/advertisers?product_id=PADS',

    // Busca e métricas de campanhas (endpoint novo)
    productAdsCampaigns: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/campaigns/search`,

    // Busca e métricas de anúncios (endpoint novo)
    productAdsAdsSearch: (advId) =>
      `https://api.mercadolibre.com/advertising/${SITE_ID}/advertisers/${advId}/product_ads/ads/search`,
  };
}

// ==========================================
// Helper de chamada autenticada
// ==========================================
async function withAuth(url, init, state) {
  const call = async (token) => {
    const headers = {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    return fetch(url, { ...init, headers });
  };

  let resp = await call(state.token);
  if (resp.status !== 401) return resp;

  const novo = await TokenService.renovarToken(state.creds);
  state.token = novo.access_token;

  return call(state.token);
}

async function prepararAuth(opts = {}) {
  const creds = { ...opts.mlCreds, accountKey: opts.accountKey };
  const token = await TokenService.renovarTokenSeNecessario(creds);
  return { token, creds };
}



// ==========================================
// Descobrir advertiser_id da conta
// ==========================================
async function obterAdvertiserId(state) {
  const U = urls();

  const r = await withAuth(
    U.advertisers,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // doc mostra Api-Version: 1 para esse endpoint
        'Api-Version': '1',
      },
    },
    state
  );
  const txt = await r.text().catch(() => '');

  if (!r.ok) {
    const err = new Error(`advertisers HTTP ${r.status} ${txt}`);
    err.code = 'ADVERTISERS_ERROR';
    throw err;
  }

  let data;
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch (e) {
    const err = new Error(`Falha ao parsear advertisers: ${e.message}`);
    err.code = 'ADVERTISERS_ERROR';
    throw err;
  }

  const list = Array.isArray(data.advertisers) ? data.advertisers : [];
  if (!list.length) {
    const err = new Error('Nenhum advertiser retornado.');
    err.code = 'NO_ADVERTISER';
    throw err;
  }

  // pega advertiser do site MLB ou o primeiro
  const adv =
    list.find((a) => a.site_id === SITE_ID) ||
    list[0];

  const id = adv.advertiser_id || adv.id;
  if (!id) {
    const err = new Error('Advertiser sem advertiser_id válido.');
    err.code = 'NO_ADVERTISER';
    throw err;
  }

  return id;
}

// ==========================================
// Helper: buscar thumbnails de vários itens (AUTENTICADO)
// ==========================================
async function buscarThumbnailsParaItens(itemIds = [], state) {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  if (!uniqueIds.length) return {};

  const map = {};
  let logged401 = false;
  const chunkSize = 20;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const slice = uniqueIds.slice(i, i + chunkSize);

    // 👉 aqui está a diferença: UM único "ids" com valores separados por vírgula
    const params = new URLSearchParams();
    params.set('ids', slice.join(','));
    params.set('attributes', 'id,thumbnail,secure_thumbnail');

    const url = `${ITEMS_URL}?${params.toString()}`;

    try {
      const r = await withAuth(
        url,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        state
      );

      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        if (r.status === 401 && !logged401) {
          console.warn(
            '[ProductAds] Falha ao buscar thumbnails (401). Verifique permissões do token para /items.'
          );
          logged401 = true;
        } else if (r.status !== 401) {
          console.warn('[ProductAds] Falha ao buscar thumbnails:', r.status, txt);
        }
        continue;
      }

      let data;
      try {
        data = txt ? JSON.parse(txt) : [];
      } catch (e) {
        console.warn('[ProductAds] Erro parseando resposta de thumbnails:', e.message);
        continue;
      }

      // Resposta típica: [{ code: 200, body: { id, thumbnail, secure_thumbnail, ... } }, ...]
      for (const row of data) {
        if (!row || row.code !== 200 || !row.body) continue;
        const body = row.body;
        if (!body.id) continue;

        map[body.id] = body.secure_thumbnail || body.thumbnail || null;
      }
    } catch (e) {
      console.warn('[ProductAds] Erro inesperado ao buscar thumbnails:', e.message);
    }
  }

  return map;
}


class ProductAdsService {
  // ======================================================
  // LISTAR CAMPANHAS (agregado por campanha)
  // ======================================================
  static async listarCampanhas({ date_from, date_to } = {}, options = {}) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      const params = new URLSearchParams();
      if (date_from) params.set('date_from', date_from);
      if (date_to)   params.set('date_to', date_to);
      params.set(
        'metrics',
        [
          'clicks',
          'prints',
          'ctr',
          'cost',
          'cpc',
          'acos',
          'roas',
          'units_quantity',
          'total_amount',
        ].join(',')
      );
      // por padrão já é campaign, mas não atrapalha:
      params.set('aggregation_type', 'campaign');
      params.set('limit', '200');

      const url = `${U.productAdsCampaigns(advertiserId)}?${params.toString()}`;

      const r = await withAuth(
        url,
        {
          method: 'GET',
          headers: {
            'api-version': '2',
          },
        },
        state
      );

      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        let code = 'CAMPAIGNS_ERROR';
        let msg = `HTTP ${r.status}`;
        try {
          const errData = txt ? JSON.parse(txt) : null;
          if (errData?.error) msg = errData.error;
          if (errData?.message) msg += ` - ${errData.message}`;
        } catch (_) {
          if (txt) msg = `HTTP ${r.status} ${txt}`;
        }
        return {
          success: false,
          error: msg,
          code,
        };
      }

      let data;
      try {
        data = txt ? JSON.parse(txt) : {};
      } catch (e) {
        return { success: false, error: `Parse error: ${e.message}`, code: 'CAMPAIGNS_ERROR' };
      }

      const campaigns = (data.results || []).map((c) => ({
        id:          c.id,
        name:        c.name,
        status:      c.status,
        strategy:    c.strategy,
        acos_target: c.acos_target,
        roas:        c.roas,
        metrics:     c.metrics || {},
      }));

      return {
        success: true,
        date_from,
        date_to,
        campaigns,
        paging: data.paging || {},
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || 'CAMPAIGNS_ERROR',
      };
    }
  }

  // ======================================================
  // LISTAR ITENS DA CAMPANHA (ads) COM MÉTRICAS + THUMB
  // ======================================================
  static async listarItensCampanha(
    campaignId,
    { date_from, date_to } = {},
    options = {}
  ) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      const params = new URLSearchParams();
      params.set(
        'metrics',
        [
          'clicks',
          'prints',
          'ctr',
          'cost',
          'cpc',
          'acos',
          'roas',
          'units_quantity',
          'total_amount',
        ].join(',')
      );
      params.set('metrics_summary', 'true');
      if (date_from) params.set('date_from', date_from);
      if (date_to)   params.set('date_to', date_to);
      params.set('aggregation_type', 'item');
      params.set('limit', '500');

      // filtro server-side por campanha
      params.set('filters[campaign_id]', String(campaignId));

      const url = `${U.productAdsAdsSearch(advertiserId)}?${params.toString()}`;

      const r = await withAuth(
        url,
        {
          method: 'GET',
          headers: {
            'api-version': '2',
          },
        },
        state
      );

      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        let code = 'ITEMS_ERROR';
        let msg = `HTTP ${r.status}`;
        try {
          const errData = txt ? JSON.parse(txt) : null;
          if (errData?.error) msg = errData.error;
          if (errData?.message) msg += ` - ${errData.message}`;
        } catch (_) {
          if (txt) msg = `HTTP ${r.status} ${txt}`;
        }
        return {
          success: false,
          error: msg,
          code,
        };
      }

      let data;
      try {
        data = txt ? JSON.parse(txt) : {};
      } catch (e) {
        return { success: false, error: `Parse error: ${e.message}`, code: 'ITEMS_ERROR' };
      }

      let items = (data.results || []).map((it) => ({
        item_id: it.item_id,
        title:   it.title,
        sku:     it.sku,
        status:  it.status,
        cpc:     it.cpc,
        metrics: it.metrics || {},
      }));

      // ---- carrega thumbnails para esses itens (AUTENTICADO) ----
      try {
        const ids = items.map((i) => i.item_id).filter(Boolean);
        const thumbsMap = await buscarThumbnailsParaItens(ids, state);
        items = items.map((it) => ({
          ...it,
          thumbnail: thumbsMap[it.item_id] || null,
        }));
      } catch (e) {
        // não quebra o fluxo se der erro em thumbs
        console.warn('Erro ao anexar thumbnails aos itens:', e.message);
      }

      return {
        success: true,
        campaign_id: campaignId,
        date_from,
        date_to,
        items,
        paging: data.paging || {},
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || 'ITEMS_ERROR',
      };
    }
  }

  // ======================================================
  // MÉTRICAS DIÁRIAS (para o gráfico)
  // ======================================================
  static async metricasDiarias(
    { date_from, date_to } = {},
    options = {}
  ) {
    try {
      const state = await prepararAuth(options);
      const advertiserId = await obterAdvertiserId(state);
      const U = urls();

      const params = new URLSearchParams();
      if (date_from) params.set('date_from', date_from);
      if (date_to)   params.set('date_to', date_to);
      params.set(
        'metrics',
        [
          'clicks',
          'prints',
          'cost',
          'total_amount',
        ].join(',')
      );
      params.set('aggregation_type', 'DAILY');
      params.set('limit', '200');

      const url = `${U.productAdsCampaigns(advertiserId)}?${params.toString()}`;

      const r = await withAuth(
        url,
        {
          method: 'GET',
          headers: {
            'api-version': '2',
          },
        },
        state
      );

      const txt = await r.text().catch(() => '');

      if (!r.ok) {
        let code = 'METRICS_ERROR';
        let msg = `HTTP ${r.status}`;
        try {
          const errData = txt ? JSON.parse(txt) : null;
          if (errData?.error) msg = errData.error;
          if (errData?.message) msg += ` - ${errData.message}`;
        } catch (_) {
          if (txt) msg = `HTTP ${r.status} ${txt}`;
        }
        return {
          success: false,
          error: msg,
          code,
        };
      }

      let data;
      try {
        data = txt ? JSON.parse(txt) : {};
      } catch (e) {
        return { success: false, error: `Parse error: ${e.message}`, code: 'METRICS_ERROR' };
      }

      // data.results é uma lista diária
      const series = (data.results || []).map((row) => ({
        date:         row.date,
        clicks:       row.clicks || 0,
        prints:       row.prints || 0,
        cost:         row.cost || 0,
        total_amount: row.total_amount || 0,
      }));

      return {
        success: true,
        date_from,
        date_to,
        series,
      };
    } catch (err) {
      return {
        success: false,
        error: err?.message || String(err),
        code: err.code || 'METRICS_ERROR',
      };
    }
  }

  // ======================================================
  // EXPORTAR CSV (BAIXAR)
  // ======================================================
  static async exportarItensCampanhaCsv(
    campaignId,
    { date_from, date_to } = {},
    options = {}
  ) {
    const { success, items, error } =
      await this.listarItensCampanha(campaignId, { date_from, date_to }, options);

    if (!success) return { success: false, error, code: 'ITEMS_ERROR' };

    const rows = [[
      'item_id', 'title', 'sku', 'status',
      'clicks', 'prints', 'ctr', 'cost', 'cpc',
      'acos', 'roas', 'units_quantity', 'total_amount',
    ]];

    for (const it of items) {
      const m = it.metrics || {};
      rows.push([
        it.item_id,
        (it.title || '').replace(/\n/g, ' '),
        it.sku || '',
        it.status || '',
        m.clicks ?? '',
        m.prints ?? '',
        m.ctr ?? '',
        m.cost ?? '',
        it.cpc ?? '',
        m.acos ?? '',
        m.roas ?? '',
        m.units_quantity ?? '',
        m.total_amount ?? '',
      ]);
    }

    const csv = rows
      .map((cols) =>
        cols
          .map((v) => {
            const s = String(v ?? '');
            return /[",;\n]/.test(s)
              ? `"${s.replace(/"/g, '""')}"` :
              s;
          })
          .join(',')
      )
      .join('\n');

    return { success: true, csv };
  }
}

module.exports = ProductAdsService;
