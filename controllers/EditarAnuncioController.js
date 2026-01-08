// controllers/EditarAnuncioController.js
"use strict";

const EditarAnuncioService = require("../services/editarAnuncioService");

function pickAccessToken(req, res) {
  // padrão do teu projeto: authMiddleware injeta req.ml.accessToken
  const token = req?.ml?.accessToken || res?.locals?.mlCreds?.access_token;
  return token || null;
}

function normalizeMlb(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({
    ok: false,
    success: false,
    error: error || "Erro",
    ...extra,
  });
}

const ALLOWED_PATCH_KEYS = new Set([
  "title",
  "price",
  "available_quantity",
  "status",
  "shipping",
  "pictures",
  "attributes",
  "sale_terms",
  "video_id",
  "warranty",
  "warranty_type",
  "listing_type_id",
  "variations",
  "tags",
  "seller_custom_field",
]);

function buildSafePatch(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};

  for (const k of Object.keys(src)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) continue;
    const v = src[k];
    if (typeof v === "undefined") continue;

    // normalizações leves
    if (k === "title") out.title = String(v).trim();
    else if (k === "price") out.price = Number(v);
    else if (k === "available_quantity") out.available_quantity = Number(v);
    else out[k] = v;
  }

  // remove NaN
  if (
    Object.prototype.hasOwnProperty.call(out, "price") &&
    !Number.isFinite(out.price)
  )
    delete out.price;
  if (
    Object.prototype.hasOwnProperty.call(out, "available_quantity") &&
    !Number.isFinite(out.available_quantity)
  )
    delete out.available_quantity;

  return out;
}

module.exports = {
  async getItem(req, res) {
    const accessToken = pickAccessToken(req, res);
    if (!accessToken)
      return jsonError(
        res,
        401,
        "Token ML ausente. Selecione a conta novamente.",
        { redirect: "/select-conta" }
      );

    const mlb = normalizeMlb(req.params.mlb);
    if (!mlb.startsWith("ML"))
      return jsonError(
        res,
        400,
        "ID inválido. Envie um MLB/MLA/MLB... válido."
      );

    try {
      const data = await EditarAnuncioService.getItemWithDescription({
        mlb,
        accessToken,
      });
      return res.json({ ok: true, success: true, ...data });
    } catch (err) {
      const status = err?.statusCode || 500;
      return jsonError(
        res,
        status,
        err?.message || "Falha ao buscar anúncio.",
        {
          details: err?.details || null,
        }
      );
    }
  },

  async updateItem(req, res) {
    const accessToken = pickAccessToken(req, res);
    if (!accessToken)
      return jsonError(
        res,
        401,
        "Token ML ausente. Selecione a conta novamente.",
        { redirect: "/select-conta" }
      );

    const mlb = normalizeMlb(req.params.mlb);
    if (!mlb.startsWith("ML")) return jsonError(res, 400, "ID inválido.");

    const patch = buildSafePatch(req.body?.patch || req.body || {});
    if (!patch || Object.keys(patch).length === 0)
      return jsonError(
        res,
        400,
        "Nenhum campo válido para atualizar (patch vazio)."
      );

    try {
      const updated = await EditarAnuncioService.updateItem({
        mlb,
        accessToken,
        patch,
      });
      return res.json({ ok: true, success: true, updated });
    } catch (err) {
      const status = err?.statusCode || 500;
      return jsonError(
        res,
        status,
        err?.message || "Falha ao atualizar anúncio.",
        {
          details: err?.details || null,
        }
      );
    }
  },

  async updateDescription(req, res) {
    const accessToken = pickAccessToken(req, res);
    if (!accessToken)
      return jsonError(
        res,
        401,
        "Token ML ausente. Selecione a conta novamente.",
        { redirect: "/select-conta" }
      );

    const mlb = normalizeMlb(req.params.mlb);
    if (!mlb.startsWith("ML")) return jsonError(res, 400, "ID inválido.");

    const plain_text = String(
      req.body?.plain_text ?? req.body?.description ?? ""
    ).trim();
    if (!plain_text) return jsonError(res, 400, "Descrição vazia.");

    try {
      const updated = await EditarAnuncioService.updateDescription({
        mlb,
        accessToken,
        plain_text,
      });
      return res.json({ ok: true, success: true, updated });
    } catch (err) {
      const status = err?.statusCode || 500;
      return jsonError(
        res,
        status,
        err?.message || "Falha ao atualizar descrição.",
        {
          details: err?.details || null,
        }
      );
    }
  },

  async upgradePremium(req, res) {
    const accessToken = pickAccessToken(req, res);
    if (!accessToken)
      return jsonError(
        res,
        401,
        "Token ML ausente. Selecione a conta novamente.",
        { redirect: "/select-conta" }
      );

    const mlb = normalizeMlb(req.params.mlb);
    if (!mlb.startsWith("ML")) return jsonError(res, 400, "ID inválido.");

    try {
      const result = await EditarAnuncioService.tryUpgradeToPremium({
        mlb,
        accessToken,
      });
      return res.json({ ok: true, success: true, ...result });
    } catch (err) {
      const status = err?.statusCode || 500;
      return jsonError(
        res,
        status,
        err?.message || "Falha ao tentar upgrade Premium.",
        {
          details: err?.details || null,
        }
      );
    }
  },

  async premiumApply(req, res) {
    const accessToken = pickAccessToken(req, res);
    if (!accessToken)
      return jsonError(
        res,
        401,
        "Token ML ausente. Selecione a conta novamente.",
        { redirect: "/select-conta" }
      );

    const mlb = normalizeMlb(req.params.mlb);
    if (!mlb.startsWith("ML")) return jsonError(res, 400, "ID inválido.");

    // payload esperado:
    // {
    //   patch: { title, price, available_quantity, ... },
    //   plain_text: "descrição...",
    //   upgrade_to_premium: true|false
    // }
    const patch = buildSafePatch(req.body?.patch || {});
    const plain_text =
      typeof req.body?.plain_text === "string"
        ? req.body.plain_text.trim()
        : "";
    const upgrade = Boolean(req.body?.upgrade_to_premium);

    if (Object.keys(patch).length === 0 && !plain_text && !upgrade) {
      return jsonError(
        res,
        400,
        "Nada para aplicar. Envie patch e/ou plain_text e/ou upgrade_to_premium."
      );
    }

    try {
      const report = await EditarAnuncioService.premiumApply({
        mlb,
        accessToken,
        patch,
        plain_text,
        upgrade_to_premium: upgrade,
      });

      return res.json({ ok: true, success: true, report });
    } catch (err) {
      const status = err?.statusCode || 500;
      return jsonError(
        res,
        status,
        err?.message || "Falha ao aplicar edição premium.",
        {
          details: err?.details || null,
        }
      );
    }
  },
};
