"use strict";

const express = require("express");
const PrazoProducaoController = require("../controllers/PrazoProducaoController");

const router = express.Router();

// Individual
router.post(
  "/anuncio/prazo-producao",
  PrazoProducaoController.setPrazoProducaoSingle
);

// Lote
router.post(
  "/anuncios/prazo-producao-lote",
  PrazoProducaoController.setPrazoProducaoLote
);

// Status (pra JobsPanel / monitor)
router.get(
  "/anuncios/status-prazo-producao/:id",
  PrazoProducaoController.statusPrazoProducao
);

module.exports = router;
