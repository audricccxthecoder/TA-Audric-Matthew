const express = require("express");
const router = express.Router();
const {
  getSummary,
  getSalesTrend,
  getTopProducts,
  getLowStock,
} = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Lapisan 2: dashboard analytics admin-only
router.use(authMiddleware, roleMiddleware("admin"));

router.get("/summary", getSummary);
router.get("/sales-trend", getSalesTrend);
router.get("/top-products", getTopProducts);
router.get("/low-stock", getLowStock);

module.exports = router;
