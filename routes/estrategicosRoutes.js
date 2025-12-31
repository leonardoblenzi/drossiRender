// routes/estrategicosRoutes.js
//
// Rotas REST para gerenciamento de Produtos Estratégicos.
// Versão DB (por meli_conta_id via ensureAccount) + compat com rotas antigas.

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

// Helper para aplicar middleware opcional
const withAccount = ensureAccount ? [ensureAccount] : [];

/**
 * GET /api/estrategicos
 * Lista todos os estratégicos da conta ML selecionada (cookie meli_conta_id).
 * Obs: parâmetro antigo ?group=... foi removido da lógica (agora é por conta/empresa via DB).
 */
router.get("/api/estrategicos", ...withAccount, EstrategicosController.list);

/**
 * POST /api/estrategicos
 * Upsert de 1 item.
 * body: { mlb, name?, percent_default? }
 */
router.post("/api/estrategicos", ...withAccount, EstrategicosController.upsert);

/**
 * PUT /api/estrategicos/:id
 * Atualiza campos editáveis de um estratégico (botão "Salvar" na linha).
 * body: { percent_default?, name? }
 */
router.put(
  "/api/estrategicos/:id",
  ...withAccount,
  EstrategicosController.update
);

/**
 * DELETE /api/estrategicos/:mlb
 * (Compat) Remove um estratégico pelo MLB (mantido para não quebrar o front antigo).
 */
router.delete(
  "/api/estrategicos/:mlb",
  ...withAccount,
  EstrategicosController.remove
);

/**
 * DELETE /api/estrategicos/id/:id
 * (Novo) Remove um estratégico pelo ID do DB.
 */
router.delete(
  "/api/estrategicos/id/:id",
  ...withAccount,
  EstrategicosController.removeById
);

/**
 * POST /api/estrategicos/replace
 * Substitui/mescla a lista inteira (upload CSV no front).
 * body: {
 *   items: [{ mlb, name?, percent_default? }],
 *   remove_missing?: boolean
 * }
 */
router.post(
  "/api/estrategicos/replace",
  ...withAccount,
  EstrategicosController.replace
);

/**
 * POST /api/estrategicos/:id/sync
 * (Novo) Sincroniza 1 item com o Mercado Livre (nome/% aplicada/status) e persiste no DB.
 * Usado pelo botão "Atualizar" na linha (via ID).
 */
router.post(
  "/api/estrategicos/:id/sync",
  ...withAccount,
  EstrategicosController.syncOne
);

/**
 * POST /api/estrategicos/mlb/:mlb/sync
 * (Compat importante) Sincroniza 1 item pelo MLB.
 *
 * IMPORTANTE:
 * - NÃO pode ser /api/estrategicos/:mlb/sync porque conflita com /:id/sync no Express.
 * - Mantemos uma rota dedicada /mlb/:mlb/sync para compat sem ambiguidade.
 */
router.post(
  "/api/estrategicos/mlb/:mlb/sync",
  ...withAccount,
  EstrategicosController.syncByMlb
);

/**
 * POST /api/estrategicos/sync
 * (Novo) Sincroniza TODOS os estratégicos da conta ML selecionada.
 * body opcional: { ids?: number[], limit?: number }
 */
router.post(
  "/api/estrategicos/sync",
  ...withAccount,
  EstrategicosController.syncAll
);

/**
 * POST /api/estrategicos/apply
 * Aplica promoções nos estratégicos usando CriarPromocaoService/promocoesService.
 * body: {
 *   promotion_type,
 *   items: [{ mlb, percent }]
 * }
 */
router.post(
  "/api/estrategicos/apply",
  ...withAccount,
  EstrategicosController.apply
);

module.exports = router;
