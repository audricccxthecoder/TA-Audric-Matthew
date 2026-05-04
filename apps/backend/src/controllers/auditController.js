const auditRepository = require("../repositories/auditRepository");
const { sendCsv } = require("../utils/csv");

const CSV_COLUMNS = [
  { key: "created_at", header: "Waktu" },
  { key: "username", header: "User" },
  { key: "user_role", header: "Role" },
  { key: "kode_barang", header: "Kode Barang" },
  { key: "nama_barang", header: "Nama Barang" },
  { key: "source_type", header: "Sumber" },
  { key: "rule_triggered", header: "Rule" },
  { key: "rule_action", header: "Aksi" },
  { key: "delta_qty", header: "Delta Qty" },
  { key: "stok_sebelum", header: "Stok Sebelum" },
  { key: "stok_sesudah", header: "Stok Sesudah" },
  { key: "reason_detail", header: "Alasan" },
  { key: "context_payload", header: "Context (JSON)" },
];

async function listAuditLogs(req, res) {
  try {
    const filters = {
      from: req.query.from || null,
      to: req.query.to || null,
      user_id: req.query.user_id || null,
      product_id: req.query.product_id || null,
      rule: req.query.rule || null,
      action: req.query.action || null,
      source_type: req.query.source_type || null,
      page: req.query.page,
      page_size: req.query.page_size,
    };

    if (req.query.format === "csv") {
      const rows = await auditRepository.listAll(filters);
      const filename = `audit-trail_${new Date().toISOString().slice(0, 10)}.csv`;
      return sendCsv(res, filename, rows, CSV_COLUMNS);
    }

    const result = await auditRepository.list(filters);
    return res.json(result);
  } catch (err) {
    console.error("[POS-AUDIT] list error:", err.message);
    return res.status(500).json({ error: "Gagal memuat audit log" });
  }
}

module.exports = { listAuditLogs };
