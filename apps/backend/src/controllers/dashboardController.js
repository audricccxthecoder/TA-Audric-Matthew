const dashboardRepository = require("../repositories/dashboardRepository");

async function getSummary(req, res) {
  try {
    const data = await dashboardRepository.getSummary();
    return res.json({ data });
  } catch (err) {
    console.error("[POS-DASH] summary error:", err.message);
    return res.status(500).json({ error: "Gagal memuat ringkasan dashboard" });
  }
}

async function getSalesTrend(req, res) {
  try {
    const days = Math.min(
      parseInt(req.query.days, 10) || 30,
      90
    );
    const data = await dashboardRepository.getSalesTrend(days);
    return res.json({ data, days });
  } catch (err) {
    console.error("[POS-DASH] salesTrend error:", err.message);
    return res.status(500).json({ error: "Gagal memuat tren penjualan" });
  }
}

async function getTopProducts(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const data = await dashboardRepository.getTopProducts({ days, limit });
    return res.json({ data, days, limit });
  } catch (err) {
    console.error("[POS-DASH] topProducts error:", err.message);
    return res.status(500).json({ error: "Gagal memuat top produk" });
  }
}

async function getLowStock(req, res) {
  try {
    const data = await dashboardRepository.getLowStockHeatmap();
    return res.json({ data });
  } catch (err) {
    console.error("[POS-DASH] lowStock error:", err.message);
    return res.status(500).json({ error: "Gagal memuat data stok menipis" });
  }
}

module.exports = { getSummary, getSalesTrend, getTopProducts, getLowStock };
