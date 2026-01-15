// services/jardinagemService.js
"use strict";

const TokenService = require("./tokenService");

// node18+ tem fetch; fallback p/ node-fetch se necessário
const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

const BASE = "https://api.mercadolibre.com";

// ============================================================================
// Utils
// ============================================================================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickErrMessage(data, fallback) {
  return (
    data?.message ||
    data?.error ||
    data?.cause?.[0]?.message ||
    data?.causes?.[0]?.message ||
    fallback ||
    "Erro na chamada ao Mercado Livre"
  );
}

async function readJsonSafe(resp) {
  try {
    return await resp.json();
  } catch (_e) {
    return null;
  }
}

async function authFetchJson({ method, url, accessToken, body, retries = 2 }) {
  let lastErr;

  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchRef(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await readJsonSafe(resp);

      if (resp.ok) return data ?? {};

      // retry em rate limit / instabilidades
      if ((resp.status === 429 || resp.status >= 500) && i < retries) {
        await sleep(450 * (i + 1));
        continue;
      }

      const msg = pickErrMessage(data, `HTTP ${resp.status}`);
      const err = new Error(msg);
      err.statusCode = resp.status;
      err.raw = data;
      throw err;
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await sleep(350 * (i + 1));
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr || new Error("Falha desconhecida em authFetchJson");
}

// ============================================================================
// Token resolution (compat com seu projeto)
// ============================================================================
async function resolveAccessToken(req) {
  // padrão do seu authMiddleware
  const t = req?.ml?.accessToken;
  if (t) return t;

  // fallback: usa TokenService (compat com serviços antigos do seu projeto)
  if (
    TokenService &&
    typeof TokenService.renovarTokenSeNecessario === "function"
  ) {
    const out = await TokenService.renovarTokenSeNecessario();
    if (typeof out === "string") return out;
    if (out && typeof out.access_token === "string") return out.access_token;
  }

  const err = new Error(
    "Access token do ML não disponível (req.ml.accessToken ausente)."
  );
  err.statusCode = 401;
  throw err;
}

// ============================================================================
// Mercado Livre primitives
// ============================================================================
async function getItem(mlb, accessToken) {
  return authFetchJson({
    method: "GET",
    url: `${BASE}/items/${encodeURIComponent(mlb)}`,
    accessToken,
  });
}

async function putItem(mlb, accessToken, body) {
  return authFetchJson({
    method: "PUT",
    url: `${BASE}/items/${encodeURIComponent(mlb)}`,
    accessToken,
    body,
  });
}

async function postRelist(mlb, accessToken, body) {
  return authFetchJson({
    method: "POST",
    url: `${BASE}/items/${encodeURIComponent(mlb)}/relist`,
    accessToken,
    body,
  });
}

async function postItem(accessToken, body) {
  return authFetchJson({
    method: "POST",
    url: `${BASE}/items`,
    accessToken,
    body,
  });
}

async function getDescription(mlb, accessToken) {
  return authFetchJson({
    method: "GET",
    url: `${BASE}/items/${encodeURIComponent(mlb)}/description`,
    accessToken,
  });
}

async function postDescription(mlb, accessToken, plain_text) {
  return authFetchJson({
    method: "POST",
    url: `${BASE}/items/${encodeURIComponent(mlb)}/description`,
    accessToken,
    body: { plain_text: String(plain_text || "") },
  });
}

// ============================================================================
// Builders
// ============================================================================
function buildRelistBodyFromItem(item, overrides) {
  const price =
    overrides?.price !== undefined && overrides?.price !== null
      ? overrides.price
      : item?.price;

  const quantity =
    overrides?.quantity !== undefined && overrides?.quantity !== null
      ? overrides.quantity
      : item?.available_quantity;

  const body = {
    // manter tipo de anúncio
    listing_type_id: item?.listing_type_id,
  };

  // variações (se existirem)
  if (Array.isArray(item?.variations) && item.variations.length) {
    body.variations = item.variations.map((v) => ({
      id: v.id,
      price:
        overrides?.price !== undefined && overrides?.price !== null
          ? overrides.price
          : v.price,
      quantity:
        overrides?.quantity !== undefined && overrides?.quantity !== null
          ? overrides.quantity
          : v.available_quantity,
    }));
    return body;
  }

  // simples (sem variações)
  if (typeof price === "number") body.price = price;
  if (Number.isInteger(quantity)) body.quantity = quantity;

  return body;
}

function pickPicturesForCreate(item) {
  const pics = Array.isArray(item?.pictures) ? item.pictures : [];
  const out = pics
    .map((p) => p?.secure_url || p?.url || p?.source)
    .filter(Boolean)
    .map((src) => ({ source: src }));
  return out.length ? out : undefined;
}

function pickAttributesForCreate(item) {
  const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
  const out = attrs
    .map((a) => ({
      id: a.id,
      value_id: a.value_id ?? null,
      value_name: a.value_name ?? null,
    }))
    .filter((a) => a.id && (a.value_id || a.value_name));
  return out.length ? out : undefined;
}

function pickShippingForCreate(item) {
  const s = item?.shipping;
  if (!s || typeof s !== "object") return undefined;

  // Mantém só campos que normalmente são aceitos na criação (evita read-only)
  const out = {};
  if (s.mode) out.mode = s.mode; // me2 / custom / not_specified (depende)
  if (typeof s.local_pick_up === "boolean") out.local_pick_up = s.local_pick_up;
  if (typeof s.free_shipping === "boolean") out.free_shipping = s.free_shipping;
  if (s.logistic_type) out.logistic_type = s.logistic_type;
  if (s.dimensions) out.dimensions = s.dimensions;
  if (typeof s.store_pick_up === "boolean") out.store_pick_up = s.store_pick_up;

  return Object.keys(out).length ? out : undefined;
}

function pickSaleTermsForCreate(item) {
  const st = Array.isArray(item?.sale_terms) ? item.sale_terms : [];
  const out = st
    .map((t) => ({
      id: t.id,
      value_id: t.value_id ?? null,
      value_name: t.value_name ?? null,
    }))
    .filter((t) => t.id && (t.value_id || t.value_name));
  return out.length ? out : undefined;
}

function pickVariationsForCreate(item, overrides) {
  const vars = Array.isArray(item?.variations) ? item.variations : [];
  if (!vars.length) return undefined;

  return vars.map((v) => {
    const ovPrice =
      overrides?.price !== undefined && overrides?.price !== null
        ? overrides.price
        : v.price;

    const ovQty =
      overrides?.quantity !== undefined && overrides?.quantity !== null
        ? overrides.quantity
        : v.available_quantity;

    const out = {
      // atributos da variação
      attribute_combinations: v.attribute_combinations || [],
      // pode ter picture_ids (se existirem)
      ...(Array.isArray(v.picture_ids) && v.picture_ids.length
        ? { picture_ids: v.picture_ids }
        : {}),
      price: ovPrice,
      available_quantity: ovQty,
    };

    // algumas contas usam seller_custom_field na variação — copia se existir
    if (v.seller_custom_field) out.seller_custom_field = v.seller_custom_field;

    return out;
  });
}

function buildCloneItemBody(item, overrides) {
  const body = {
    title: overrides?.title || item?.title,
    category_id: item?.category_id,
    price:
      overrides?.price !== undefined && overrides?.price !== null
        ? overrides.price
        : item?.price,
    currency_id: item?.currency_id || "BRL",
    buying_mode: item?.buying_mode || "buy_it_now",
    listing_type_id: item?.listing_type_id,
    condition: item?.condition,
    // por padrão, cria ativo
    status: "active",
  };

  // quantity: se tiver variação, vai em variations[].available_quantity
  if (!Array.isArray(item?.variations) || !item.variations.length) {
    body.available_quantity =
      overrides?.quantity !== undefined && overrides?.quantity !== null
        ? overrides.quantity
        : item?.available_quantity;
  }

  const pics = pickPicturesForCreate(item);
  if (pics) body.pictures = pics;

  const attrs = pickAttributesForCreate(item);
  if (attrs) body.attributes = attrs;

  const ship = pickShippingForCreate(item);
  if (ship) body.shipping = ship;

  const saleTerms = pickSaleTermsForCreate(item);
  if (saleTerms) body.sale_terms = saleTerms;

  const variations = pickVariationsForCreate(item, overrides);
  if (variations) body.variations = variations;

  // catálogo (quando aplicável)
  if (item?.catalog_product_id)
    body.catalog_product_id = item.catalog_product_id;
  if (typeof item?.catalog_listing === "boolean")
    body.catalog_listing = item.catalog_listing;

  return body;
}

// ============================================================================
// Core actions
// ============================================================================
async function onlyPause(mlb, accessToken) {
  // status paused
  return putItem(mlb, accessToken, { status: "paused" });
}

async function onlyClose(mlb, accessToken) {
  // status closed (finaliza, mas não "deleta")
  return putItem(mlb, accessToken, { status: "closed" });
}

async function closeThenRelist(mlb, accessToken, overrides) {
  const item = await getItem(mlb, accessToken);

  // garante fechado (relist geralmente requer closed)
  if (item?.status !== "closed") {
    await onlyClose(mlb, accessToken);
  }

  const relistBody = buildRelistBodyFromItem(item, overrides);
  const relisted = await postRelist(mlb, accessToken, relistBody);

  return { item, relisted };
}

async function pauseThenRelist(mlb, accessToken, overrides) {
  const item = await getItem(mlb, accessToken);

  // pausa primeiro
  if (item?.status !== "paused") {
    await onlyPause(mlb, accessToken);
  }

  // tenta relist direto (se a API recusar por não estar closed, fazemos fallback)
  try {
    const relistBody = buildRelistBodyFromItem(item, overrides);
    const relisted = await postRelist(mlb, accessToken, relistBody);
    return { item, relisted, fallback_closed: false };
  } catch (e) {
    // fallback: fechar e relistar
    await onlyClose(mlb, accessToken);
    const relistBody = buildRelistBodyFromItem(item, overrides);
    const relisted = await postRelist(mlb, accessToken, relistBody);
    return {
      item,
      relisted,
      fallback_closed: true,
      fallback_reason: e.message,
    };
  }
}

async function cloneNewThenCloseOld(mlb, accessToken, overrides) {
  const item = await getItem(mlb, accessToken);

  const cloneBody = buildCloneItemBody(item, overrides);

  // cria novo item
  const created = await postItem(accessToken, cloneBody);
  const newId = created?.id;

  // tenta copiar descrição (best effort)
  let descCopied = false;
  let descError = null;
  if (newId) {
    try {
      const d = await getDescription(mlb, accessToken);
      const plain = d?.plain_text;
      if (plain && String(plain).trim()) {
        await postDescription(newId, accessToken, plain);
        descCopied = true;
      }
    } catch (e) {
      descError = e.message;
    }
  }

  // fecha o antigo (best effort, mas aqui faz parte do modo)
  const closedOld = await onlyClose(mlb, accessToken);

  return {
    old_item: item,
    created,
    new_id: newId,
    desc_copied: descCopied,
    desc_error: descError,
    closed_old: closedOld,
  };
}

// ============================================================================
// Helpers (IDs)
// ============================================================================
function pickNewMlbFromRelist(out) {
  return out?.relisted?.id || out?.relisted?.item_id || null;
}

function pickNewMlbFromClone(out) {
  return out?.new_id || out?.created?.id || null;
}

// ============================================================================
// Public API (used by controller)
// ============================================================================
class JardinagemService {
  /**
   * Processa 1 item
   */
  static async processSingle({ mlb, mode, clone_overrides, req }) {
    const accessToken = await resolveAccessToken(req);

    const steps = [];
    const startedAt = new Date();

    const step = (name, detail) => {
      steps.push({
        name,
        ok: true,
        at: new Date().toISOString(),
        ...(detail ? { detail } : {}),
      });
    };
    const stepErr = (name, err) => {
      steps.push({
        name,
        ok: false,
        at: new Date().toISOString(),
        error: err?.message || String(err),
        raw: err?.raw || undefined,
      });
    };

    try {
      step("start", { mlb, mode });

      if (mode === "ONLY_PAUSE") {
        const out = await onlyPause(mlb, accessToken);
        step("pause", { status: out?.status || "paused" });
        return {
          ok: true,
          success: true,
          mode,
          mlb,
          // ✅ padronização (unitário)
          mlb_old: mlb,
          mlb_new: null,
          new_mlb: null,
          result: out,
          steps,
          meta: { started_at: startedAt, finished_at: new Date() },
        };
      }

      if (mode === "ONLY_CLOSE") {
        const out = await onlyClose(mlb, accessToken);
        step("close", { status: out?.status || "closed" });
        return {
          ok: true,
          success: true,
          mode,
          mlb,
          // ✅ padronização (unitário)
          mlb_old: mlb,
          mlb_new: null,
          new_mlb: null,
          result: out,
          steps,
          meta: { started_at: startedAt, finished_at: new Date() },
        };
      }

      if (mode === "CLOSE_RELIST") {
        const out = await closeThenRelist(mlb, accessToken, clone_overrides);
        const newId = pickNewMlbFromRelist(out);

        step("close_relist", { new_id: newId });

        return {
          ok: true,
          success: true,
          mode,
          mlb,
          relisted_id: newId,
          // ✅ padronização (unitário)
          mlb_old: mlb,
          mlb_new: newId,
          new_mlb: newId,
          result: out,
          steps,
          meta: { started_at: startedAt, finished_at: new Date() },
        };
      }

      if (mode === "PAUSE_RELIST") {
        const out = await pauseThenRelist(mlb, accessToken, clone_overrides);
        const newId = pickNewMlbFromRelist(out);

        step("pause_relist", {
          new_id: newId,
          fallback_closed: out?.fallback_closed || false,
        });

        return {
          ok: true,
          success: true,
          mode,
          mlb,
          relisted_id: newId,
          // ✅ padronização (unitário)
          mlb_old: mlb,
          mlb_new: newId,
          new_mlb: newId,
          result: out,
          steps,
          meta: { started_at: startedAt, finished_at: new Date() },
        };
      }

      if (mode === "CLONE_NEW_CLOSE_OLD") {
        const out = await cloneNewThenCloseOld(
          mlb,
          accessToken,
          clone_overrides
        );
        const newId = pickNewMlbFromClone(out);

        step("clone_new_close_old", {
          new_id: newId,
          desc_copied: out?.desc_copied,
        });

        return {
          ok: true,
          success: true,
          mode,
          mlb,
          new_id: newId,
          // ✅ padronização (unitário)
          mlb_old: mlb,
          mlb_new: newId,
          new_mlb: newId,
          result: out,
          steps,
          meta: { started_at: startedAt, finished_at: new Date() },
        };
      }

      // fallback (não deveria chegar)
      return {
        ok: false,
        success: false,
        mode,
        mlb,
        error: "Modo não implementado",
        steps,
        meta: { started_at: startedAt, finished_at: new Date() },
      };
    } catch (err) {
      stepErr("error", err);
      return {
        ok: false,
        success: false,
        mode,
        mlb,
        error: err.message || "Erro ao processar Jardinagem (unitário)",
        steps,
        meta: { started_at: startedAt, finished_at: new Date() },
      };
    }
  }

  /**
   * Processa lote (sem clone)
   */
  static async processBulk({
    mlbs,
    mode,
    processId,
    procRef,
    delayMs = 250,
    req,
  }) {
    const accessToken = await resolveAccessToken(req);

    const total = mlbs.length;
    procRef.status = "processando";
    procRef.total = total;

    for (let idx = 0; idx < mlbs.length; idx++) {
      const mlb = mlbs[idx];

      try {
        // segurança: clone não roda no lote
        if (mode === "CLONE_NEW_CLOSE_OLD") {
          throw new Error("CLONE_NEW_CLOSE_OLD não é permitido no lote.");
        }

        let out;
        if (mode === "ONLY_PAUSE") out = await onlyPause(mlb, accessToken);
        else if (mode === "ONLY_CLOSE") out = await onlyClose(mlb, accessToken);
        else if (mode === "CLOSE_RELIST")
          out = await closeThenRelist(mlb, accessToken, null);
        else if (mode === "PAUSE_RELIST")
          out = await pauseThenRelist(mlb, accessToken, null);
        else throw new Error("Modo inválido no lote.");

        const newId =
          mode === "CLOSE_RELIST" || mode === "PAUSE_RELIST"
            ? pickNewMlbFromRelist(out)
            : null;

        procRef.sucessos += 1;

        // ✅ formato padrão pro CSV
        procRef.resultados.push({
          mlb_old: mlb,
          mlb_new: newId,
          status: "success",
          error: "",
          mode,
          // mantém compat (se você ainda usa em algum lugar)
          ok: true,
          relisted_id: newId,
        });
      } catch (err) {
        procRef.erros += 1;

        // ✅ formato padrão pro CSV
        procRef.resultados.push({
          mlb_old: mlb,
          mlb_new: null,
          status: "error",
          error: err.message || "Erro no processamento",
          mode,
          // mantém compat
          ok: false,
          raw: err.raw || undefined,
        });
      } finally {
        procRef.processados += 1;
        procRef.progresso = Math.round((procRef.processados / total) * 100);
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    procRef.status = "concluido";
    procRef.concluido_em = new Date();

    return {
      ok: true,
      success: true,
      process_id: processId,
      status: procRef.status,
      total: procRef.total,
      processados: procRef.processados,
      sucessos: procRef.sucessos,
      erros: procRef.erros,
    };
  }
}

module.exports = JardinagemService;
