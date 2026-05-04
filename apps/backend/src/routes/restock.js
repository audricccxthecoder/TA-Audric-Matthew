const express = require("express");
const router = express.Router();
const { getRestockRecommendations } = require("../controllers/restockController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// R5 — Rekomendasi Restock. Admin-only sesuai sub-bab 3.2 laporan.
router.use(authMiddleware, roleMiddleware("admin"));

router.get("/", getRestockRecommendations);

module.exports = router;
