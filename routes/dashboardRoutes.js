"use strict";

const express = require("express");
const router = express.Router();

const DashboardController = require("../controllers/DashboardController");

// GET /api/dashboard/monthly-sales
router.get("/monthly-sales", DashboardController.getMonthlySales);

module.exports = router;
