"use strict";

const express = require("express");
const FullController = require("../controllers/FullController");

const router = express.Router();

// Listar (com paginação / busca / filtro)
router.get("/anuncios", FullController.list);

// Adicionar MLB (faz fetch no ML, pega inventory_id e stock fulfillment)
router.post("/anuncios", FullController.add);

// Atualizar/sincronizar (todos ou selecionados)
router.post("/anuncios/sync", FullController.sync);

// Remover em lote
router.post("/anuncios/bulk-delete", FullController.bulkDelete);

// Remover 1
router.delete("/anuncios/:mlb", FullController.removeOne);

module.exports = router;
