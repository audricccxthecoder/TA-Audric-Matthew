const express = require("express");
const router = express.Router();
const {
  searchProducts,
  getProduct,
  createProduct,
  updateProduct,
} = require("../controllers/productsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.use(authMiddleware, roleMiddleware("kasir", "admin"));

router.get("/", searchProducts);
router.get("/:id", getProduct);
router.post("/", createProduct);
router.patch("/:id", updateProduct);

module.exports = router;
