// routes/fullRoutes.js (com novas rotas CRUD)
const express = require('express');
const router = express.Router();
const FullController = require('../controllers/FullController');

// Rotas existentes
router.get('/products', FullController.listProducts);
router.get('/products/:mlb', FullController.getProductDetail);

// NOVAS ROTAS CRUD
router.post('/products', FullController.addProduct);           // Adicionar produto
router.delete('/products', FullController.removeProducts);     // Remover produtos
router.put('/products/:mlb/sync', FullController.syncProduct); // Sincronizar produto
router.get('/stats', FullController.getStats);                 // Estatísticas

module.exports = router;