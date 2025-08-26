// routes/promocoesRoutes.js
const express = require('express');
const PromocoesController = require('../controllers/PromocoesController');

// Base sem prefixo — facilita criar aliases sem duplicar caminhos
const base = express.Router();
base.get('/users', PromocoesController.users);
base.get('/promotions/:promotionId/items', PromocoesController.promotionItems);

// Monta com 3 prefixos (compat com seu front e evita 404/console poluído)
const router = express.Router();
router.use('/api/promocoes', base);   // canônico
router.use('/api/promocao', base);    // alias
router.use('/api/promotions', base);  // alias

module.exports = router;
