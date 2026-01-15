"use strict";

const express = require("express");
const router = express.Router();

const JardinagemController = require("../controllers/JardinagemController");

// ✅ alias compat com seu front:
// POST /api/jardinagem/item
router.post("/item", JardinagemController.single);

// (opcional) também deixa o nome “single” pra debug/legibilidade
router.post("/single", JardinagemController.single);

// POST /api/jardinagem/bulk
router.post("/bulk", JardinagemController.bulk);

// GET /api/jardinagem/status/:id
router.get("/status/:id", JardinagemController.status);

// ping
router.get("/ping", (_req, res) =>
  res.json({ ok: true, feature: "jardinagem" })
);

module.exports = router;
