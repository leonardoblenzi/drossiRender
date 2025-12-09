// routes/estrategicosRoutes.js
//
// Rotas REST para gerenciamento de Produtos Estratégicos.

const express = require('express');
const EstrategicosController = require('../controllers/EstrategicosController');

const router = express.Router();

/**
 * GET /api/estrategicos
 * Lista todos os estratégicos da conta/grupo atual.
 * Query opcional: ?group=drossi|diplany|rossidecor
 */
router.get('/api/estrategicos', EstrategicosController.list);

/**
 * POST /api/estrategicos
 * Upsert de 1 item.
 * body: { mlb, name?, percent_default? }
 * - Se não tiver name, o controller busca o título no ML.
 */
router.post('/api/estrategicos', EstrategicosController.upsert);

/**
 * DELETE /api/estrategicos/:mlb
 * Remove um estratégico pelo MLB.
 */
router.delete('/api/estrategicos/:mlb', EstrategicosController.remove);

/**
 * POST /api/estrategicos/replace
 * Substitui/mescla a lista inteira (JSON).
 * body: {
 *   items: [{ mlb, name?, percent_default? }],
 *   remove_missing?: boolean
 * }
 * -> Usado pelo upload CSV via front (fetch /replace).
 */
router.post('/api/estrategicos/replace', EstrategicosController.replace);

/**
 * POST /api/estrategicos/apply
 * Aplica promoções nos estratégicos usando CriarPromocaoService.
 * body: {
 *   promotion_type,
 *   items: [{ mlb, percent }]
 * }
 */
router.post('/api/estrategicos/apply', EstrategicosController.apply);

module.exports = router;
