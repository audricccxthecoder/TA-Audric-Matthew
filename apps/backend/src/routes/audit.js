const express = require("express");
const router = express.Router();
const { listAuditLogs } = require("../controllers/auditController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Lapisan 2: audit trail admin-only
router.use(authMiddleware, roleMiddleware("admin"));

router.get("/", listAuditLogs);

module.exports = router;
