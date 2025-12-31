// routes/estrategicosRoutes.js
//
// Rotas REST para gerenciamento de Produtos Estratégicos.
// Versão DB (por meli_conta_id via ensureAccount) + compat com rotas antigas.
//
// ✅ Importante: rotas por MLB e por ID NÃO podem conflitar.
//    Por isso:
//    - Sync por MLB: /api/estrategicos/:mlb/sync
//    - Sync por ID:  /api/estrategicos/id/:id/sync   (bem específico)

"use strict";

const express = require("express");
const EstrategicosController = require("../controllers/EstrategicosController");

const router = express.Router();

// Middleware de conta (cookie meli_conta_id) — tenta carregar, mas não quebra se ainda não existir
let ensureAccount = null;
try {
  ({ ensureAccount } = require("../middlewares/ensureAccount"));
} catch (e) {
  ensureAccount = null;
}

const withAccount = ensureAccount ? [ensureAccount] : [];

/**
 * GET /api/estrategicos
 */
router.get("/api/estrategicos", ...withAccount, EstrategicosController.list);

/**
 * POST /api/estrategicos
 * Upsert de 1 item.
 */
router.post("/api/estrategicos", ...withAccount, EstrategicosController.upsert);

/**
 * PUT /api/estrategicos/:id
 */
router.put(
  "/api/estrategicos/:id",
  ...withAccount,
  EstrategicosController.update
);

/**
 * DELETE /api/estrategicos/:mlb (compat)
 */
router.delete(
  "/api/estrategicos/:mlb",
  ...withAccount,
  EstrategicosController.remove
);

/**
 * DELETE /api/estrategicos/id/:id
 */
router.delete(
  "/api/estrategicos/id/:id",
  ...withAccount,
  EstrategicosController.removeById
);

/**
 * POST /api/estrategicos/replace
 */
router.post(
  "/api/estrategicos/replace",
  ...withAccount,
  EstrategicosController.replace
);

/**
 * ✅ SYNC POR MLB (compat e o que seu front está chamando agora)
 * POST /api/estrategicos/:mlb/sync
 *
 * Tem que vir ANTES de rotas com :id se elas forem parecidas,
 * mas aqui já deixamos a rota por ID em /id/:id/sync para evitar conflito de vez.
 */
router.post(
  "/api/estrategicos/:mlb/sync",
  ...withAccount,
  EstrategicosController.syncByMlb
);

/**
 * ✅ SYNC POR ID (bem específico para não conflitar)
 * POST /api/estrategicos/id/:id/sync
 */
router.post(
  "/api/estrategicos/id/:id/sync",
  ...withAccount,
  EstrategicosController.syncOne
);

/**
 * POST /api/estrategicos/sync (sync all)
 */
router.post(
  "/api/estrategicos/sync",
  ...withAccount,
  EstrategicosController.syncAll
);

/**
 * POST /api/estrategicos/apply
 */
router.post(
  "/api/estrategicos/apply",
  ...withAccount,
  EstrategicosController.apply
);

module.exports = router;
