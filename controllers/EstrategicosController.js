// controllers/EstrategicosController.js
//
// Persistência em JSON por grupo (drossi / diplany / rossidecor)
// + integração com CriarPromocaoService para aplicar promoções.
// + snapshot de promoções ativas direto da API do ML (mesma lógica da Curva ABC)

const fs = require('fs').promises;
const path = require('path');
const CriarPromocaoService = require('../services/criarPromocaoService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ALLOWED_GROUPS = new Set(['drossi', 'diplany', 'rossidecor']);

// fetch compatível (Node <18)
const _fetch = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
const fetchRef = (...args) => _fetch(...args);

// -------------------- Helpers de grupo/arquivo --------------------

function resolveGroup(req, res) {
  const qGroup = (req.query.group || req.body?.group || '').toString().trim().toLowerCase();
  if (ALLOWED_GROUPS.has(qGroup)) return qGroup;

  const accKey = (res.locals.accountKey || '').toString().trim().toLowerCase();
  if (ALLOWED_GROUPS.has(accKey)) return accKey;

  // fallback – pode ajustar se quiser um "default"
  return 'drossi';
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getFilePath(group) {
  return path.join(DATA_DIR, `estrategicos_${group}.json`);
}

function toNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function normalizeItem(raw = {}, idx = 0) {
  const mlb = (raw.mlb || '').toString().trim();
  return {
    id: raw.id || `row-${idx + 1}`,
    mlb,
    name: (raw.name || '').toString(),
    percent_default: toNumOrNull(raw.percent_default),
    percent_cycle: toNumOrNull(raw.percent_cycle),
    percent_applied: toNumOrNull(raw.percent_applied),
    status: (raw.status || '').toString()
  };
}

// Carrega itens do JSON; se não existir, volta lista vazia
async function loadItems(group) {
  await ensureDataDir();
  const file = getFilePath(group);

  try {
    const txt = await fs.readFile(file, 'utf8');
    const json = JSON.parse(txt);

    if (Array.isArray(json.items)) {
      return { items: json.items.map(normalizeItem), meta: json.meta || {} };
    }
    if (Array.isArray(json)) {
      return { items: json.map(normalizeItem), meta: {} };
    }
    return { items: [], meta: {} };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[Estrategicos] Erro ao ler arquivo ${file}:`, err.message || err);
    }
    return { items: [], meta: {} };
  }
}

async function saveItems(group, items, metaExtra = {}) {
  await ensureDataDir();
  const file = getFilePath(group);
  const payload = {
    group,
    updated_at: new Date().toISOString(),
    total: items.length,
    meta: metaExtra,
    items
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
}

// ====================================================================
// ===================== HELPERS DE PROMO (ML) ========================
// ===== Copiados/adaptados do analytics-abc-Routes.js para uso aqui ==
// ====================================================================

/** GET JSON com retry simples */
async function httpGetJson(url, headers, retries = 3, dbgArr = null) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    let r, status, text;
    try {
      r = await fetchRef(url, { headers });
      status = r.status;
      text = await r.text();
    } catch (e) {
      lastErr = e;
      continue;
    }

    if (dbgArr) {
      dbgArr.push({
        type: 'http',
        url,
        status,
        body: (text || '').slice(0, 512)
      });
    }

    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise(res => setTimeout(res, 400 * (i + 1)));
      continue;
    }
    if (!r.ok) {
      lastErr = new Error(`GET ${url} -> ${status}`);
      break;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      break;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/** Token provider (mesma ideia do ABC) */
async function getToken(app, req, accountId) {
  const injected = app.get('getAccessTokenForAccount');
  if (typeof injected === 'function') return injected(accountId, req);
  try {
    const { getAccessTokenForAccount } = require('../services/ml-auth');
    return getAccessTokenForAccount(accountId, req);
  } catch {
    throw new Error(
      `Não foi possível obter token para a conta "${accountId}". ` +
      `Configure app.set('getAccessTokenForAccount', fn) ou crie services/ml-auth.js`
    );
  }
}

/** Seller ID do token */
async function getSellerId(token) {
  const r = await fetchRef('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`users/me ${r.status}`);
  const me = await r.json();
  return me.id;
}

/** Mescla duas fontes de promo (prioriza ativo e maior %). */
function mergePromo(a, b) {
  const A = a || { active: false, percent: null, source: null };
  const B = b || { active: false, percent: null, source: null };
  const aPct = (A.percent != null ? Number(A.percent) : null);
  const bPct = (B.percent != null ? Number(B.percent) : null);

  // se uma estiver ativa e a outra não, mantém a ativa
  if (A.active && !B.active) return A;
  if (B.active && !A.active) return B;

  // ambas ativas (ou ambas inativas): fica com a que tiver maior % conhecida
  if (aPct != null && bPct != null) return (bPct > aPct) ? B : A;

  // somente uma tem % → use a que tem % (se empatar, prioriza A)
  if (bPct != null && aPct == null) return B;
  return A;
}

/**
 * Lê a Prices API do item e tenta inferir promoção ativa “agora”.
 * Mesmo código do Curva ABC.
 */
async function fetchItemPromoNow({ token, itemId, dbgArr }) {
  const url = `https://api.mercadolibre.com/items/${itemId}/prices`;

  const pct = (full, price) => {
    const f = Number(full || 0), p = Number(price || 0);
    if (f > 0 && p > 0 && p < f) return 1 - (p / f);
    return null;
  };

  try {
    const j = await httpGetJson(url, { Authorization: `Bearer ${token}` }, 2, dbgArr);

    const buckets = [];
    if (Array.isArray(j?.prices?.prices)) buckets.push(...j.prices.prices);
    if (Array.isArray(j?.prices)) buckets.push(...j.prices);
    if (Array.isArray(j?.reference_prices)) buckets.push(...j.reference_prices);

    const promoNodes = Array.isArray(j?.promotions) ? j.promotions : [];

    const nowMs = Date.now();
    const candidates = [];

    // 1) Preços com type=promotion dentro da janela
    for (const p of buckets) {
      const t  = String(p?.type || '').toLowerCase();
      if (t !== 'promotion') continue;

      const df = p?.conditions?.start_time || p?.date_from || p?.start_time;
      const dt = p?.conditions?.end_time   || p?.date_to   || p?.end_time;
      const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                       (!dt || nowMs <= new Date(dt).getTime());

      if (!inWindow) continue;

      const percent = pct(p?.regular_amount, p?.amount);
      if (percent !== null && percent > 0) {
        const source = p?.metadata?.campaign_id ? 'marketplace_campaign' : 'seller_promotion';
        candidates.push({ percent, source, active: true });
      }
    }

    // 2) Nó “promotions”
    for (const p of promoNodes) {
      const st = String(p?.status || '').toLowerCase();
      const df = p?.date_from || p?.start_time;
      const dt = p?.date_to   || p?.end_time;
      const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                       (!dt || nowMs <= new Date(dt).getTime());
      const isActive = (st ? st === 'active' : true) && inWindow;
      if (!isActive) continue;

      const percent = pct(p?.regular_amount || p?.base_price, p?.price || p?.amount);
      if (percent !== null && percent > 0) {
        const source = (p?.type || p?.campaign_type || p?.origin || 'promotion').toString();
        candidates.push({ percent, source, active: true });
      }
    }

    // 3) Fallback standard/active
    const anyPrice = (buckets || []).find(x => x?.amount);
    if (anyPrice && anyPrice?.regular_amount) {
      const percent = pct(anyPrice.regular_amount, anyPrice.amount);
      if (percent !== null && percent > 0) {
        candidates.push({ percent, source: 'inferred_from_regular_amount', active: true });
      }
    }

    if (candidates.length) {
      candidates.sort((a, b) => (b.percent || 0) - (a.percent || 0));
      const best = candidates[0];
      return { active: true, percent: best.percent, source: best.source };
    }

    return { active: false, percent: null, source: null };
  } catch (e) {
    dbgArr && dbgArr.push({ type: 'promo_error', url, message: e.message || String(e) });
    return { active: false, percent: null, source: null };
  }
}

/**
 * Central de Promoções em batch — mesma função do ABC, simplificada para uso aqui.
 */
async function fetchPromotionsForItemsBatch({ token, sellerId, itemIds, promosDbg }) {
  const out = {};
  const ids = Array.from(new Set((itemIds || []).map(i => String(i).toUpperCase())));
  if (!ids.length) return out;

  const keepBetter = (prev, next) => mergePromo(prev, next);

  const bySite = new Map();
  for (const id of ids) {
    const site = id.slice(0, 3);
    if (!bySite.has(site)) bySite.set(site, new Set());
    bySite.get(site).add(id);
  }

  const base = 'https://api.mercadolibre.com';
  const headers = { Authorization: `Bearer ${token}` };
  const nowMs = Date.now();

  for (const [site, wantedSet] of bySite.entries()) {
    const searchUrl = new URL(`${base}/seller-promotions/search`);
    searchUrl.searchParams.set('site_id', site);
    searchUrl.searchParams.set('seller_id', String(sellerId));
    searchUrl.searchParams.set('status', 'active');

    let promos;
    try {
      promos = await httpGetJson(searchUrl.toString(), headers, 2, promosDbg);
    } catch (e) {
      promosDbg && promosDbg.push({ type: 'promos_search_error', url: String(searchUrl), message: e.message });
      continue;
    }

    const list = Array.isArray(promos?.results) ? promos.results
                : Array.isArray(promos?.promotions) ? promos.promotions
                : [];

    for (const p of list) {
      const promoId = p.id || p.promotion_id;
      if (!promoId) continue;

      let offset = 0;
      const limit = 200;
      for (;;) {
        const itemsUrl = new URL(`${base}/seller-promotions/${promoId}/items`);
        itemsUrl.searchParams.set('offset', String(offset));
        itemsUrl.searchParams.set('limit', String(limit));

        let j;
        try {
          j = await httpGetJson(itemsUrl.toString(), headers, 2, promosDbg);
        } catch (e) {
          promosDbg && promosDbg.push({ type: 'promos_items_error', url: String(itemsUrl), message: e.message });
          break;
        }

        const arr = Array.isArray(j?.results) ? j.results
                  : Array.isArray(j?.items) ? j.items
                  : [];

        for (const it of arr) {
          const itemId = String(it.item_id || it.id || '').toUpperCase();
          if (!itemId || !wantedSet.has(itemId)) continue;

          const st = String(it.status || '').toLowerCase();
          const df = it.date_from || it.start_time;
          const dt = it.date_to   || it.end_time;

          const inWindow = (!df || nowMs >= new Date(df).getTime()) &&
                           (!dt || nowMs <= new Date(dt).getTime());
          const itemActive = (st ? st === 'active' : true) && inWindow;
          if (!itemActive) continue;

          let pct =
            it.applied_percentage ??
            it.discount_percentage ??
            it.discount_rate ??
            it.benefit_percentage ??
            null;
          if (pct != null) {
            pct = Number(pct);
            if (!Number.isFinite(pct)) pct = null;
            else if (pct > 1) pct = pct / 100;
            if (pct <= 0) pct = null;
          }

          const next = { active: true, percent: pct, source: 'seller_promotion_batch' };
          out[itemId] = keepBetter(out[itemId], next);
        }

        const total = j?.paging?.total ?? j?.total ?? arr.length;
        offset += limit;
        if (offset >= total) break;
      }
    }
  }

  return out;
}

/** Fallback de promo por /items/{id}/prices + /items/{id} (mesmo do ABC) */
async function fetchPromotionForItemFallback({ token, itemId, promosDbg }) {
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const u = `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/prices`;
    const j = await httpGetJson(u, headers, 2, promosDbg);

    const prices = [];
    if (Array.isArray(j?.prices?.prices)) prices.push(...j.prices.prices);
    if (Array.isArray(j?.prices)) prices.push(...j.prices);

    const current = prices.find(p => p.type === 'standard' || p.status === 'active');
    const promo   = prices.find(p => p.type === 'promotion');

    const pct = (orig, now) => {
      const o = Number(orig || 0), n = Number(now || 0);
      return (o > 0 && n > 0 && n < o) ? (1 - n / o) : null;
    };

    if (promo) {
      const percent = pct(promo.regular_amount, promo.amount);
      if (percent !== null) return { active: true, percent, source: 'prices_promotion' };
    }

    if (current && current.regular_amount) {
      const percent = pct(current.regular_amount, current.amount);
      if (percent !== null) return { active: true, percent, source: 'prices_regular_amount' };
    }
  } catch (e) {
    promosDbg && promosDbg.push({ type: 'prices_api_error', itemId, message: e.message });
  }

  try {
    const u = `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?attributes=price,original_price`;
    const j = await httpGetJson(u, headers, 2, promosDbg);
    const price = Number(j?.price ?? NaN);
    const original = Number(j?.original_price ?? NaN);
    if (Number.isFinite(price) && Number.isFinite(original) && original > price) {
      const pct = (original - price) / original;
      return { active: true, percent: pct, source: 'items_original_price' };
    }
  } catch (e) {
    promosDbg && promosDbg.push({ type: 'items_api_error', itemId, message: e.message });
  }

  return { active: false, percent: null, source: null };
}

/**
 * Snapshot de promo para lista de MLBs de UMA conta,
 * usando o mesmo pipeline do /abc-ml/items:
 * - Central de promoções (batch)
 * - Fallback /items/{id}/prices
 * - Merge de fontes
 */
async function getPromosSnapshotForList({ req, res, group, mlbIds }) {
  const app = req.app;
  const accountKey = res.locals?.accountKey || group || 'default';

  const token = await getToken(app, req, accountKey);
  const sellerId = await getSellerId(token);

  const ids = Array.from(
    new Set((mlbIds || []).map(id => String(id || '').toUpperCase()).filter(Boolean))
  );
  if (!ids.length) return {};

  const dbg = { calls: [] };

  // 1) batch Central de Promoções
  const batchMap = await fetchPromotionsForItemsBatch({
    token,
    sellerId,
    itemIds: ids,
    promosDbg: dbg.calls
  });

  // 2) prices snapshot
  const pricesMap = {};
  for (const id of ids) {
    try {
      pricesMap[id] = await fetchItemPromoNow({ token, itemId: id, dbgArr: dbg.calls });
    } catch (e) {
      dbg.calls.push({ type: 'prices_single_error', itemId: id, message: e.message });
      pricesMap[id] = { active: false, percent: null, source: null };
    }
  }

  // 3) fallback extra por item (mesma ideia do ABC)
  for (const id of ids) {
    if (batchMap[id]) continue; // já tem do batch
    try {
      const fb = await fetchPromotionForItemFallback({ token, itemId: id, promosDbg: dbg.calls });
      if (fb && fb.active) {
        batchMap[id] = mergePromo(batchMap[id], fb);
      }
    } catch (e) {
      dbg.calls.push({ type: 'promo_fallback_error', itemId: id, message: e.message });
    }
  }

  // 4) merge final (prices + central)
  const out = {};
  for (const id of ids) {
    const merged = mergePromo(pricesMap[id], batchMap[id]);
    out[id] = {
      active: !!merged.active,
      percent: merged.percent != null ? Number(merged.percent) : null, // 0..1
      source: merged.source || batchMap[id]?.source || pricesMap[id]?.source || null
    };
  }

  return out;
}

// ====================================================================
// ============================ CONTROLLER ============================
// ====================================================================

class EstrategicosController {
  // GET /api/estrategicos?group=drossi
  static async list(req, res) {
    try {
      const group = resolveGroup(req, res);
      const { items, meta } = await loadItems(group);

      // flag opcional pra desligar ML (ex: debug): ?include_promos=0
      const includePromos = String(req.query.include_promos || '1') !== '0';

      let itemsOut = items;

      if (includePromos && items.length) {
        try {
          const mlbIds = items.map(i => i.mlb).filter(Boolean);
          const promoMap = await getPromosSnapshotForList({ req, res, group, mlbIds });

          itemsOut = items.map(it => {
            const key = String(it.mlb || '').toUpperCase();
            const promo = promoMap[key];

            if (promo && promo.active && promo.percent != null) {
              // percent vem 0..1 do pipeline da Curva ABC
              const pct100 = promo.percent * 100;

              // só preenche se ainda não tiver valor salvo (pra não sobrescrever histórico da tela)
              const hasApplied = it.percent_applied != null && !Number.isNaN(Number(it.percent_applied));

              return {
                ...it,
                percent_applied: hasApplied ? it.percent_applied : pct100,
                status: it.status || 'Promoção ativa'
              };
            }

            return it;
          });
        } catch (e) {
          console.error('[EstrategicosController.list] Erro ao buscar promoções ML:', e);
          // se der erro, continua retornando a lista crua do JSON
        }
      }

      return res.json({
        ok: true,
        group,
        total: itemsOut.length,
        meta,
        items: itemsOut
      });
    } catch (err) {
      console.error('[EstrategicosController.list] Erro:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos
  // body: { group?, mlb, name?, percent_default?, percent_cycle?, percent_applied?, status? }
  static async upsert(req, res) {
    try {
      const group = resolveGroup(req, res);
      const body = req.body || {};
      const mlb = (body.mlb || '').toString().trim();

      if (!mlb) {
        return res.status(400).json({ ok: false, error: 'mlb é obrigatório' });
      }

      const { items } = await loadItems(group);
      const idx = items.findIndex(i => (i.mlb || '').toUpperCase() === mlb.toUpperCase());
      const base = idx >= 0 ? items[idx] : {};

      const item = normalizeItem(
        {
          ...base,
          ...body
        },
        idx >= 0 ? idx : items.length
      );

      if (idx >= 0) items[idx] = item;
      else items.push(item);

      await saveItems(group, items);
      return res.json({ ok: true, group, item });
    } catch (err) {
      console.error('[EstrategicosController.upsert] Erro:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }

  // DELETE /api/estrategicos/:mlb
  static async remove(req, res) {
    try {
      const group = resolveGroup(req, res);
      const mlbParam = (req.params.mlb || '').toString().trim();
      if (!mlbParam) {
        return res.status(400).json({ ok: false, error: 'mlb ausente na URL' });
      }

      const { items } = await loadItems(group);
      const before = items.length;
      const filtered = items.filter(
        i => (i.mlb || '').toUpperCase() !== mlbParam.toUpperCase()
      );
      const removed = before - filtered.length;

      await saveItems(group, filtered);

      return res.json({
        ok: true,
        group,
        removed,
        total: filtered.length
      });
    } catch (err) {
      console.error('[EstrategicosController.remove] Erro:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/replace
  // body: { group?, items: [...] }
  static async replace(req, res) {
    try {
      const group = resolveGroup(req, res);
      const body = req.body || {};
      const list = Array.isArray(body.items) ? body.items : [];

      const norm = list.map((raw, idx) => normalizeItem(raw, idx));

      await saveItems(group, norm);
      return res.json({
        ok: true,
        group,
        total: norm.length
      });
    } catch (err) {
      console.error('[EstrategicosController.replace] Erro:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/upload
  // multipart/form-data com field "file" (CSV)
  // body: { group?, remove_missing?: "1" | "0" }
  static async upload(req, res) {
    try {
      const group = resolveGroup(req, res);
      const file = req.file;
      const removeMissing = String(req.body?.remove_missing || '0') === '1';

      if (!file) {
        return res.status(400).json({ ok: false, error: 'Arquivo não enviado (field "file")' });
      }

      const ext = path.extname(file.originalname || '').toLowerCase();

      if (ext !== '.csv') {
        return res.status(400).json({
          ok: false,
          error: 'Atualmente apenas CSV é suportado. Exporte o Excel como .csv.'
        });
      }

      const text = file.buffer.toString('utf8');
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      if (!lines.length) {
        return res.status(400).json({ ok: false, error: 'Arquivo vazio.' });
      }

      // Cabeçalho – busca colunas mlb / percent
      const header = lines[0].split(/[,;|\t]/).map(h => h.trim().toLowerCase());
      const mlbIdx = header.findIndex(h => h === 'mlb');
      const pctIdx = header.findIndex(h => h === 'percent' || h === 'percentual' || h === 'desconto');

      if (mlbIdx === -1 || pctIdx === -1) {
        return res.status(400).json({
          ok: false,
          error: 'Cabeçalho inválido. Esperado colunas "mlb" e "percent".'
        });
      }

      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const rowText = lines[i].trim();
        if (!rowText) continue;
        const cols = rowText.split(/[,;|\t]/);
        const mlb = (cols[mlbIdx] || '').toString().trim();
        const pct = toNumOrNull(cols[pctIdx]);
        if (!mlb || pct == null) continue;
        parsed.push({ mlb, percent: pct });
      }

      if (!parsed.length) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhuma linha válida encontrada (mlb + percent).'
        });
      }

      // Mescla com itens existentes
      const { items: existing } = await loadItems(group);
      const existingMap = new Map(
        existing.map(i => [String(i.mlb || '').toUpperCase(), normalizeItem(i)])
      );

      const seen = new Set();
      const merged = [];

      for (const row of parsed) {
        const key = row.mlb.toUpperCase();
        seen.add(key);
        const base = existingMap.get(key) || {
          id: `row-${merged.length + 1}`,
          mlb: row.mlb,
          name: '',
          percent_default: null,
          percent_cycle: null,
          percent_applied: null,
          status: ''
        };

        merged.push({
          ...base,
          mlb: row.mlb,
          percent_default: row.percent,
          percent_cycle: row.percent
        });
      }

      if (!removeMissing) {
        // Mantém itens que não estavam no arquivo
        for (const [key, it] of existingMap.entries()) {
          if (!seen.has(key)) merged.push(it);
        }
      }

      await saveItems(group, merged, { source: 'upload-csv' });

      return res.json({
        ok: true,
        group,
        total: merged.length,
        from_file: parsed.length,
        removed_by_file: removeMissing ? existing.length - merged.length : 0,
        message: 'Arquivo processado com sucesso.'
      });
    } catch (err) {
      console.error('[EstrategicosController.upload] Erro:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/estrategicos/apply
  // body: { group?, promotion_type, items: [{ mlb, percent }] }
  static async apply(req, res) {
    try {
      const group = resolveGroup(req, res);
      const { promotion_type, items } = req.body || {};

      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ ok: false, error: 'Informe "items": [{ mlb, percent }]' });
      }

      const t = String(promotion_type || 'DEAL').toUpperCase();

      const list = items
        .map(r => ({
          mlb: (r.mlb || '').toString().trim(),
          percent: toNumOrNull(r.percent)
        }))
        .filter(r => r.mlb && r.percent != null && r.percent > 0);

      if (!list.length) {
        return res.status(400).json({ ok: false, error: 'Nenhum item válido (mlb + percent > 0).' });
      }

      const options = {
        mlCreds: res.locals?.mlCreds || {},
        accountKey: res.locals?.accountKey,
        logger: console
      };

      const { items: existing } = await loadItems(group);
      const indexByMlb = new Map(
        existing.map((i, idx) => [String(i.mlb || '').toUpperCase(), { item: i, idx }])
      );

      const results = [];
      let okCount = 0;

      for (const it of list) {
        try {
          const out = await CriarPromocaoService.aplicarDescontoUnico(
            it.mlb,
            it.percent,
            options
          );

          const success = !!out?.success;
          if (success) okCount++;

          const key = it.mlb.toUpperCase();
          const found = indexByMlb.get(key);
          if (found) {
            existing[found.idx] = {
              ...existing[found.idx],
              percent_cycle: it.percent,
              percent_applied: it.percent,
              status: success ? 'Promoção aplicada' : 'Falha na aplicação'
            };
          } else {
            existing.push(
              normalizeItem(
                {
                  mlb: it.mlb,
                  name: '',
                  percent_default: it.percent,
                  percent_cycle: it.percent,
                  percent_applied: success ? it.percent : null,
                  status: success ? 'Promoção aplicada' : 'Falha na aplicação'
                },
                existing.length
              )
            );
          }

          results.push({
            mlb: it.mlb,
            percent: it.percent,
            success,
            response: out
          });
        } catch (errApply) {
          console.error('[EstrategicosController.apply] Erro em', it.mlb, errApply);
          results.push({
            mlb: it.mlb,
            percent: it.percent,
            success: false,
            error: errApply.message || String(errApply)
          });
        }
      }

      await saveItems(group, existing, { last_apply_type: t });

      return res.json({
        ok: true,
        group,
        promotion_type: t,
        total: list.length,
        applied_ok: okCount,
        results,
        message: `Aplicação de promoção finalizada. Sucesso em ${okCount}/${list.length}.`
      });
    } catch (err) {
      console.error('[EstrategicosController.apply] Erro geral:', err);
      return res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  }
}

module.exports = EstrategicosController;
