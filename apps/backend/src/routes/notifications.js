const express = require("express");
const router = express.Router();
const { getLowStockNotifications } = require("../controllers/notificationsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Notifikasi badge — admin dan kasir keduanya butuh tahu barang menipis
// (sesuai CLAUDE.md Fase 5.1).
router.use(authMiddleware, roleMiddleware("admin", "kasir"));

router.get("/low-stock", getLowStockNotifications);

module.exports = router;
