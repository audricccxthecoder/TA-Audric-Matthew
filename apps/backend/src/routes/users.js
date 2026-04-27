const express = require("express");
const router = express.Router();
const { register } = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Semua endpoint user-management hanya admin
router.use(authMiddleware, roleMiddleware("admin"));

// POST /api/users — buat user kasir/admin baru
router.post("/", register);

module.exports = router;
