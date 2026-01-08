// routes/editarAnuncioRoutes.js
"use strict";

const express = require("express");
const ensurePermission = require("../middleware/ensurePermission");
const EditarAnuncioController = require("../controllers/EditarAnuncioController");

const router = express.Router();

/**
 * Recomendo proteger por ADMIN|MASTER, porque isso altera anúncio e pode subir pra Premium.
 * Se você quiser liberar para "padrao", remova o ensurePermission abaixo.
 */
router.use(ensurePermission.requireAdmin());

// Health simples (debug)
router.get("/health", (_req, res) =>
  res.json({ ok: true, feature: "editar-anuncio" })
);

// Buscar dados do anúncio (item + description)
router.get("/:mlb", EditarAnuncioController.getItem);

// Atualizar campos do item (PUT /items/:id)
router.put("/:mlb", EditarAnuncioController.updateItem);

// Atualizar descrição (PUT /items/:id/description)
router.put("/:mlb/description", EditarAnuncioController.updateDescription);

// Tentar upgrade para Premium (listing_type gold_pro) com checagem/fallback
router.post("/:mlb/upgrade-premium", EditarAnuncioController.upgradePremium);

// “Edição Premium”: patch do item + descrição + upgrade Premium (tudo em sequência)
router.post("/:mlb/premium-apply", EditarAnuncioController.premiumApply);

module.exports = router;
