// services/adsService.js
'use strict';

const _fetch = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
const fetchRef = (...args) => _fetch(...args);

const METRICS_LIST = [
  'clicks','prints','ctr','cost','cpc','acos',
  'organic_units_quantity','organic_units_amount','organic_items_quantity',
  'direct_items_quantity','indirect_items_quantity','advertising_items_quantity',
  'cvr','roas','sov',
  'direct_units_quantity','indirect_units_quantity','units_quantity',
  'direct_amount','indirect_amount','total_amount'
].join(',');

const DEFAULT_CHANNEL = 'marketplace';     // ou 'mshops'
const DEFAULT_AGGREGATION_TYPE = 'item';   // 'item' | 'DAILY'
const DEFAULT_AGGREGATION = 'sum';         // doc: padrão sum

const MAX_ATTEMPTS = 3;

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function getProfile(access_token){
  const r = await fetchRef('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  if (!r.ok) throw new Error(`users/me ${r.status}`);
  return r.json(); // { id, site_id, ... }
}

function normalizeItemMetrics(json){
  const ms   = json?.metrics_summary || {};
  const cid  = typeof json?.campaign_id === 'number' ? json.campaign_id : null;
  const stat = json?.status || null;

  const impressions = Number(ms.prints || ms.impressions || 0);
  const clicks      = Number(ms.clicks || 0);
  const spend       = Number(ms.cost   || 0);            // em moeda local
  const revenue     = Number(ms.total_amount || 0);      // em moeda local

  const spend_cents   = Math.round(spend * 100);
  const revenue_cents = Math.round(revenue * 100);

  // esteve em campanha (pertence a alguma campanha), independentemente de ter tráfego
  const in_campaign = !!cid && cid !== 0;
  // atividade no período (teve tráfego ou gasto)
  const had_activity = impressions > 0 || clicks > 0 || spend > 0 || revenue > 0;

  const acos = revenue > 0 ? (spend / revenue) : null;

  return {
    in_campaign,                   // <<<
    status: stat || (had_activity ? 'active' : null),
    campaign_id: cid,
    had_activity,
    // métricas resumidas
    clicks,
    impressions,
    spend_cents,
    revenue_cents,
    acos,
    raw_status: json?.status || null,
  };
}


/** Handler genérico com backoff p/ 429 e códigos para ignorar */
async function doFetch(url, { access_token }) {
  let attempts = 0;
  for (;;) {
    attempts++;
    const r = await fetchRef(url, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'api-version': '2',
        accept: 'application/json'
      }
    });

    if (r.status === 429) {
      if (attempts >= MAX_ATTEMPTS) throw new Error(`429 após ${attempts} tentativas`);
      await sleep(300 * attempts);
      continue;
    }

    // Sem dados/permissão p/ o item: trate como “não tem ADS”
    if ([400, 403, 404].includes(r.status)) return null;

    if (!r.ok) throw new Error(`${url.pathname} -> ${r.status}`);
    return r.json();
  }
}

/** Nova rota (métricas): /advertising/{SITE}/product_ads/ads/{ITEM_ID} */
async function fetchAdsItemV2Ads({ siteId, itemId, access_token, date_from, date_to }) {
  const u = new URL(`https://api.mercadolibre.com/advertising/${encodeURIComponent(siteId)}/product_ads/ads/${encodeURIComponent(itemId)}`);
  u.searchParams.set('date_from', date_from);
  u.searchParams.set('date_to',   date_to);
  u.searchParams.set('metrics',   METRICS_LIST);
  u.searchParams.set('aggregation_type', DEFAULT_AGGREGATION_TYPE);
  u.searchParams.set('aggregation', DEFAULT_AGGREGATION);
  u.searchParams.set('channel',   DEFAULT_CHANNEL);

  const json = await doFetch(u, { access_token });
  return json ? normalizeItemMetrics(json) : null;
}

/** Nova rota (detalhe+metrics_summary): /advertising/{SITE}/product_ads/items/{ITEM_ID} */
async function fetchAdsItemV2Items({ siteId, itemId, access_token, date_from, date_to }) {
  const u = new URL(`https://api.mercadolibre.com/advertising/${encodeURIComponent(siteId)}/product_ads/items/${encodeURIComponent(itemId)}`);
  u.searchParams.set('date_from', date_from);
  u.searchParams.set('date_to',   date_to);
  u.searchParams.set('metrics',   METRICS_LIST);
  u.searchParams.set('aggregation_type', DEFAULT_AGGREGATION_TYPE);
  u.searchParams.set('aggregation', DEFAULT_AGGREGATION);
  u.searchParams.set('channel',   DEFAULT_CHANNEL);

  const json = await doFetch(u, { access_token });
  return json ? normalizeItemMetrics(json) : null;
}

/** Legado: /advertising/product_ads/items/{ITEM_ID} (sem SITE) */
async function fetchAdsItemLegacy({ itemId, access_token, date_from, date_to }) {
  const u = new URL(`https://api.mercadolibre.com/advertising/product_ads/items/${encodeURIComponent(itemId)}`);
  u.searchParams.set('date_from', date_from);
  u.searchParams.set('date_to',   date_to);
  u.searchParams.set('metrics',   METRICS_LIST);
  u.searchParams.set('aggregation_type', DEFAULT_AGGREGATION_TYPE);
  u.searchParams.set('aggregation', DEFAULT_AGGREGATION);
  u.searchParams.set('channel',   DEFAULT_CHANNEL);

  const json = await doFetch(u, { access_token });
  return json ? normalizeItemMetrics(json) : null;
}

/**
 * Busca métricas de Ads por lista de MLBs (respeitando o período).
 * Tenta V2 (ads) → V2 (items) → legado (items sem SITE).
 * Retorna: { MLB -> { in_campaign, had_activity, clicks, impressions, spend_cents, revenue_cents, acos, ... } }
 */
async function metricsPorItens({ mlbIds, date_from, date_to, access_token }) {
  const ids = Array.from(new Set((mlbIds || []).map(x => String(x || '').toUpperCase()).filter(Boolean)));
  if (!ids.length) return {};

  let siteId = 'MLB';
  try {
    const me = await getProfile(access_token);
    if (me?.site_id) siteId = me.site_id;
  } catch { /* mantém MLB */ }

  const out = {};
  const CONCURRENCY = 6;
  let idx = 0;

  async function worker(){
    while (idx < ids.length) {
      const i = idx++;
      const itemId = ids[i];

      let attempts = 0;
      for (;;) {
        attempts++;
        try {
          // 1) Nova rota “ads”
          let met = await fetchAdsItemV2Ads({ siteId, itemId, access_token, date_from, date_to });

          // 2) Se não vier, tenta nova rota “items”
          if (!met) {
            met = await fetchAdsItemV2Items({ siteId, itemId, access_token, date_from, date_to });
          }

          // 3) Se ainda não, cai pra legada
          if (!met) {
            met = await fetchAdsItemLegacy({ itemId, access_token, date_from, date_to });
          }

          if (met) out[itemId] = met;
          break;
        } catch (e) {
          if (attempts >= MAX_ATTEMPTS) {
            // Não derruba tudo: só loga e segue.
            // eslint-disable-next-line no-console
            console.warn(`Ads metrics falharam para ${itemId}: ${e.message || e}`);
            break;
          }
          await sleep(250 * attempts);
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

module.exports = { metricsPorItens };
