const express = require("express");
const router = express.Router();
const { createSale, listSales } = require("../controllers/salesController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Lapisan 2: kasir & admin boleh transaksi penjualan
router.use(authMiddleware, roleMiddleware("kasir", "admin"));

router.post("/", createSale);
router.get("/", listSales);

module.exports = router;
