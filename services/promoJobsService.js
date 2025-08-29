// ==== NOVO (apply mass) ====
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const PromoSelectionStore = require('./promoSelectionStore');


// processa aplicação/remoção em massa
queue.process('promos:apply_mass', 2, async (job) => {
  const { token, action, values, accountKey, expected_total } = job.data || {};
  const sel = await PromoSelectionStore.getSelection(token);
  if (!sel) throw new Error('selection token inválido/expirado');

  const data = sel.data || {};
  const credsSeed = {
    accountKey,
    access_token: process.env[`ML_${String(accountKey).toUpperCase()}_ACCESS_TOKEN`],
    refresh_token: process.env[`ML_${String(accountKey).toUpperCase()}_REFRESH_TOKEN`],
    client_id: process.env[`ML_${String(accountKey).toUpperCase()}_CLIENT_ID`],
    client_secret: process.env[`ML_${String(accountKey).toUpperCase()}_CLIENT_SECRET`],
  };

  const callML = async (url, init={}) => {
    let t = (await TokenService.renovarTokenSeNecessario(credsSeed)) || {};
    const headers = { ...(init.headers||{}), Authorization: `Bearer ${t.access_token}`, Accept:'application/json' };
    const r = await fetch(url, { ...init, headers });
    if (r.status !== 401) return r;
    t = await TokenService.renovarToken(credsSeed);
    const headers2 = { ...(init.headers||{}), Authorization: `Bearer ${t.access_token}`, Accept:'application/json' };
    return fetch(url, { ...init, headers: headers2 });
  };

  // percorre a campanha paginando e filtrando
  const qsBase = new URLSearchParams();
  qsBase.set('promotion_type', String(data.promotion_type));
  if (data.status) qsBase.set('status', String(data.status));
  qsBase.set('limit', '50');
  qsBase.set('app_version', 'v2');

  const min = Number.isFinite(Number(data.percent_min)) ? Number(data.percent_min) : null;
  const max = Number.isFinite(Number(data.percent_max)) ? Number(data.percent_max) : null;

  let done = 0, total = Number(expected_total||0), next = null, firstLoop = true;
  job.progress({ processed: done, total });

  for (let guard=0; guard<600; guard++) {
    const qs = new URLSearchParams(qsBase);
    if (next) qs.set('search_after', String(next));
    const url = `https://api.mercadolibre.com/seller-promotions/promotions/${encodeURIComponent(data.promotion_id)}/items?${qs.toString()}`;
    const r = await callML(url);
    if (!r.ok) break;

    const j = await r.json().catch(()=>({}));
    const rows = Array.isArray(j.results) ? j.results : [];
    if (firstLoop && !total) { total = rows.length; job.progress({ processed: done, total }); firstLoop=false; }

    // filtra por % (usa price/top_deal/min_discounted quando necessário)
    const filtered = rows.filter(it => {
      const original = it.original_price ?? null;
      let p = it.price ?? it.top_deal_price ?? it.min_discounted_price ?? it.suggested_discounted_price ?? null;
      const pct = (original && p) ? (1 - (Number(p)/Number(original)))*100 : null;
      if (min!=null && (pct==null || pct < min)) return false;
      if (max!=null && (pct==null || pct > max)) return false;
      return true;
    });

    // aplica / remove um a um (pequenos lotes respeitam limite)
    for (const it of filtered) {
      const id = it.id || it.item_id;
      const endpoint = `https://api.mercadolibre.com/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`;

      if (action === 'remove') {
        const u = `${endpoint}&promotion_id=${encodeURIComponent(data.promotion_id)}&promotion_type=${encodeURIComponent(data.promotion_type)}`;
        await callML(u, { method: 'DELETE' }).catch(()=>{});
      } else {
        // apply (payload conforme tipo)
        const typ = String(data.promotion_type).toUpperCase();
        const payload = { promotion_id: data.promotion_id, promotion_type: typ };
        if (['SMART','PRICE_MATCHING'].includes(typ)) {
          if (values?.offer_id) payload.offer_id = values.offer_id;
        } else if (['DEAL','SELLER_CAMPAIGN','PRICE_DISCOUNT','DOD'].includes(typ)) {
          // se não veio deal_price, tenta mínimo permitido
          const deal = values?.deal_price ?? it.min_discounted_price ?? it.suggested_discounted_price ?? it.price ?? null;
          if (deal != null) payload.deal_price = deal;
          if (values?.top_deal_price != null) payload.top_deal_price = values.top_deal_price;
        }
        await callML(endpoint, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        }).catch(()=>{});
      }

      done++;
      if (done % 5 === 0) job.progress({ processed: done, total });
    }

    next = j?.paging?.next_token || null;
    if (!next || rows.length === 0) break;
  }

  job.progress({ processed: done, total });
  await PromoSelectionStore.updateMeta(token, { last_run_at: Date.now() });
  return { processed: done, total };
});
async function enqueueApplyMass(data) {
  if (!queue) throw new Error('queue não inicializada');
  return queue.add('promos:apply_mass', data, {
    removeOnComplete: true,
    attempts: 1,
    backoff: { type:'fixed', delay: 1000 }
  });
}
module.exports.enqueueApplyMass = enqueueApplyMass;
