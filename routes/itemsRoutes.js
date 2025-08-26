// routes/itemsRoutes.js
const express = require('express');
const ItemsController = require('../controllers/ItemsController');
const router = express.Router();

// Pega dados de 1 item (para preview/enriquecimento)
router.get('/api/items/:id', ItemsController.getOne);

module.exports = router;
