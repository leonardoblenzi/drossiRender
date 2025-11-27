// routes/validarDimensoesRoutes.js
const express = require('express');
const ValidarDimensoesController = require('../controllers/ValidarDimensoesController');

const router = express.Router();

// NÃO colocar /api aqui, só o sufixo
router.post('/analisar-item', ValidarDimensoesController.analisarItem);

module.exports = router;
