const express = require("express");
const router = express.Router();
const { searchProducts } = require("../controllers/productsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.use(authMiddleware, roleMiddleware("kasir", "admin"));

router.get("/", searchProducts);

module.exports = router;
