// routes/promocoesRoutes.js
const express = require('express');
const PromocoesController = require('../controllers/PromocoesController');

const base = express.Router();
base.get('/users', PromocoesController.users);
base.get('/promotions/:promotionId/items', PromocoesController.promotionItems);

const router = express.Router();
router.use('/api/promocoes', base);   // canônico
router.use('/api/promocao', base);    // alias
router.use('/api/promotions', base);  // alias

module.exports = router;
