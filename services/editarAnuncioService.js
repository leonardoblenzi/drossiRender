// services/editarAnuncioService.js
"use strict";

const _fetch = typeof fetch !== "undefined" ? fetch : require("node-fetch");
const fetchRef = (...args) => _fetch(...args);

const ML_API_BASE = process.env.ML_API_BASE || "https://api.mercadolibre.com";

function buildErr(message, statusCode, details) {
  const e = new Error(message);
  e.statusCode = statusCode || 500;
  e.details = details || null;
  return e;
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function mlRequest(
  path,
  { method = "GET", accessToken, body, headers = {} } = {}
) {
  const url = path.startsWith("http") ? path : `${ML_API_BASE}${path}`;

  const finalHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...headers,
  };

  let finalBody = undefined;
  if (typeof body !== "undefined") {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  const res = await fetchRef(url, {
    method,
    headers: finalHeaders,
    body: finalBody,
  });

  const data = await readJsonSafe(res);

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `HTTP ${res.status} ao chamar ML: ${method} ${path}`;
    throw buildErr(msg, res.status, data);
  }

  return data;
}

function stripNullish(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === "undefined") continue;
    if (v === null) continue;
    out[k] = v;
  }
  return out;
}

/**
 * NOTA:
 * - Update item: PUT /items/:id
 * - Description: GET/PUT /items/:id/description
 * - Available listing types (nem sempre disponível): GET /items/:id/available_listing_types
 */
module.exports = {
  async getItemWithDescription({ mlb, accessToken }) {
    const item = await mlRequest(`/items/${encodeURIComponent(mlb)}`, {
      accessToken,
    });

    let description = null;
    try {
      description = await mlRequest(
        `/items/${encodeURIComponent(mlb)}/description`,
        { accessToken }
      );
    } catch (e) {
      // Algumas contas/itens podem ter restrição; não falha o GET geral
      description = {
        _error: true,
        message: e.message,
        details: e.details || null,
      };
    }

    return { item, description };
  },

  async updateItem({ mlb, accessToken, patch }) {
    const safePatch = stripNullish(patch);

    // Guard rails básicos
    if (Object.prototype.hasOwnProperty.call(safePatch, "title")) {
      if (!safePatch.title || safePatch.title.length < 5) {
        throw buildErr("Título muito curto.", 400, { field: "title" });
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePatch, "price")) {
      if (!(Number(safePatch.price) > 0))
        throw buildErr("Preço inválido.", 400, { field: "price" });
    }
    if (Object.prototype.hasOwnProperty.call(safePatch, "available_quantity")) {
      if (!(Number(safePatch.available_quantity) >= 0)) {
        throw buildErr("Quantidade inválida.", 400, {
          field: "available_quantity",
        });
      }
    }

    // PUT /items/:id
    const updated = await mlRequest(`/items/${encodeURIComponent(mlb)}`, {
      method: "PUT",
      accessToken,
      body: safePatch,
    });

    return updated;
  },

  async updateDescription({ mlb, accessToken, plain_text }) {
    const payload = { plain_text: String(plain_text || "").trim() };
    if (!payload.plain_text) throw buildErr("Descrição vazia.", 400);

    const updated = await mlRequest(
      `/items/${encodeURIComponent(mlb)}/description`,
      {
        method: "PUT",
        accessToken,
        body: payload,
      }
    );

    return updated;
  },

  async getAvailableListingTypes({ mlb, accessToken }) {
    // Nem sempre existe em todos os sites/contas; pode retornar 404
    const data = await mlRequest(
      `/items/${encodeURIComponent(mlb)}/available_listing_types`,
      {
        accessToken,
      }
    );
    return data;
  },

  async tryUpgradeToPremium({ mlb, accessToken }) {
    const steps = [];
    const result = {
      mlb,
      from: null,
      to: "gold_pro",
      upgraded: false,
      steps,
    };

    // 1) Descobrir listing atual
    const item = await mlRequest(`/items/${encodeURIComponent(mlb)}`, {
      accessToken,
    });
    result.from = item?.listing_type_id || null;

    if (result.from === "gold_pro") {
      steps.push({
        step: "already_premium",
        ok: true,
        message: "Já está em Premium (gold_pro).",
      });
      result.upgraded = true;
      return result;
    }

    // 2) Checar se premium está disponível (se endpoint existir)
    let available = null;
    try {
      available = await this.getAvailableListingTypes({ mlb, accessToken });
      steps.push({
        step: "available_listing_types",
        ok: true,
        data: available,
      });
    } catch (e) {
      steps.push({
        step: "available_listing_types",
        ok: false,
        message:
          "Endpoint não disponível (ou bloqueado) — seguindo com tentativa direta.",
        details: e.details || null,
      });
    }

    // Se veio lista, tenta validar se gold_pro está permitido
    if (available) {
      const list = Array.isArray(available)
        ? available
        : available?.available_listing_types || available?.results || [];
      const allowed = Array.isArray(list)
        ? list.map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean)
        : [];

      if (allowed.length && !allowed.includes("gold_pro")) {
        steps.push({
          step: "check_allowed",
          ok: false,
          message:
            "gold_pro não está na lista de upgrades disponíveis para este item.",
          allowed,
        });
        return result; // sem throw: devolve relatório bonitinho
      }
      steps.push({ step: "check_allowed", ok: true, allowed });
    }

    // 3) Tenta PUT com listing_type_id = gold_pro
    try {
      const updated = await this.updateItem({
        mlb,
        accessToken,
        patch: { listing_type_id: "gold_pro" },
      });

      steps.push({ step: "put_item_listing_type", ok: true, updated });
      result.upgraded = true;
      return result;
    } catch (e) {
      steps.push({
        step: "put_item_listing_type",
        ok: false,
        message: e.message,
        details: e.details || null,
      });
      return result; // devolve relatório sem quebrar
    }
  },

  async premiumApply({
    mlb,
    accessToken,
    patch,
    plain_text,
    upgrade_to_premium,
  }) {
    const steps = [];

    // 0) snapshot inicial
    let before = null;
    try {
      before = await mlRequest(`/items/${encodeURIComponent(mlb)}`, {
        accessToken,
      });
      steps.push({
        step: "snapshot_before",
        ok: true,
        listing_type_id: before?.listing_type_id,
        status: before?.status,
      });
    } catch (e) {
      steps.push({
        step: "snapshot_before",
        ok: false,
        message: e.message,
        details: e.details || null,
      });
    }

    // 1) patch item
    if (patch && Object.keys(patch).length > 0) {
      try {
        const updatedItem = await this.updateItem({ mlb, accessToken, patch });
        steps.push({ step: "update_item", ok: true, updated: updatedItem });
      } catch (e) {
        steps.push({
          step: "update_item",
          ok: false,
          message: e.message,
          details: e.details || null,
        });
      }
    }

    // 2) description
    if (plain_text && plain_text.trim()) {
      try {
        const updatedDesc = await this.updateDescription({
          mlb,
          accessToken,
          plain_text,
        });
        steps.push({
          step: "update_description",
          ok: true,
          updated: updatedDesc,
        });
      } catch (e) {
        steps.push({
          step: "update_description",
          ok: false,
          message: e.message,
          details: e.details || null,
        });
      }
    }

    // 3) upgrade premium
    if (upgrade_to_premium) {
      try {
        const up = await this.tryUpgradeToPremium({ mlb, accessToken });
        steps.push({ step: "upgrade_premium", ok: true, result: up });
      } catch (e) {
        steps.push({
          step: "upgrade_premium",
          ok: false,
          message: e.message,
          details: e.details || null,
        });
      }
    }

    // 4) snapshot final
    let after = null;
    try {
      after = await mlRequest(`/items/${encodeURIComponent(mlb)}`, {
        accessToken,
      });
      steps.push({
        step: "snapshot_after",
        ok: true,
        listing_type_id: after?.listing_type_id,
        status: after?.status,
      });
    } catch (e) {
      steps.push({
        step: "snapshot_after",
        ok: false,
        message: e.message,
        details: e.details || null,
      });
    }

    return {
      mlb,
      ok: steps.every((s) => s.ok !== false), // ok geral (se qualquer falhar, vira false)
      steps,
      before,
      after,
    };
  },
};
