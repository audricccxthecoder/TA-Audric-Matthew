const salesService = require("../services/salesService");
const salesRepository = require("../repositories/salesRepository");

// GET /api/sales/:id — detail transaksi (header + items) untuk drill-down
async function getSaleDetail(req, res) {
  try {
    const data = await salesRepository.getReceipt(req.params.id);
    if (!data) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
    return res.json({ data });
  } catch (err) {
    console.error("[POS-SALES] getSaleDetail error:", err.message);
    return res.status(500).json({ error: "Gagal memuat detail transaksi" });
  }
}

// POST /api/sales
async function createSale(req, res) {
  const { items } = req.body;

  try {
    const receipt = await salesService.createSale({
      user: req.user,
      items,
    });
    return res.status(201).json({
      message: "Transaksi berhasil",
      data: receipt,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[POS-SALES] createSale error:", err.message);
    } else {
      console.warn(`[POS-SALES] ${err.rule || ""} ${status}: ${err.message}`);
    }
    return res.status(status).json({
      error: err.message,
      rule: err.rule || null,
      failures: err.failures || undefined,
    });
  }
}

// GET /api/sales?from=&to=&limit=
async function listSales(req, res) {
  try {
    const { from, to, limit } = req.query;
    const data = await salesService.listSales({
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return res.json({ data });
  } catch (err) {
    console.error("[POS-SALES] listSales error:", err.message);
    return res.status(500).json({ error: "Gagal memuat daftar transaksi" });
  }
}

module.exports = { createSale, listSales, getSaleDetail };
