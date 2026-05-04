const reportsRepository = require("../repositories/reportsRepository");
const { sendCsv } = require("../utils/csv");

const SALES_CSV_COLUMNS = [
  { key: "sale_created_at", header: "Tanggal" },
  { key: "kode_transaksi", header: "Kode Transaksi" },
  { key: "kasir", header: "Kasir" },
  { key: "kode_barang", header: "Kode Barang" },
  { key: "nama_barang", header: "Nama Barang" },
  { key: "merk", header: "Merk" },
  { key: "qty", header: "Qty" },
  { key: "harga_satuan", header: "Harga Satuan" },
  { key: "subtotal", header: "Subtotal" },
];

const PURCHASE_CSV_COLUMNS = [
  { key: "purchase_created_at", header: "Tanggal" },
  { key: "no_nota", header: "No Nota Supplier" },
  { key: "user", header: "Diinput Oleh" },
  { key: "kode_barang", header: "Kode Barang" },
  { key: "nama_barang", header: "Nama Barang" },
  { key: "merk", header: "Merk" },
  { key: "qty", header: "Qty" },
  { key: "harga_beli", header: "Harga Beli" },
  { key: "diskon_persen", header: "Diskon (%)" },
  { key: "source", header: "Sumber Input" },
  { key: "status_validasi", header: "Status Validasi" },
  {
    key: "subtotal",
    header: "Subtotal",
    format: (v) => (typeof v === "number" ? v.toFixed(2) : v),
  },
];

async function getSalesReport(req, res) {
  try {
    const { from, to, format } = req.query;
    const data = await reportsRepository.listSalesReport({ from, to });
    if (format === "csv") {
      const filename = `laporan-penjualan_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      return sendCsv(res, filename, data, SALES_CSV_COLUMNS);
    }
    const summary = data.reduce(
      (acc, r) => {
        acc.total_qty += Number(r.qty);
        acc.total_revenue += Number(r.subtotal);
        acc.transaction_ids.add(r.sale_id);
        return acc;
      },
      { total_qty: 0, total_revenue: 0, transaction_ids: new Set() }
    );
    return res.json({
      data,
      summary: {
        total_qty: summary.total_qty,
        total_revenue: summary.total_revenue,
        total_transactions: summary.transaction_ids.size,
        total_items: data.length,
      },
    });
  } catch (err) {
    console.error("[POS-REPORT] sales error:", err.message);
    return res.status(500).json({ error: "Gagal memuat laporan penjualan" });
  }
}

async function getPurchaseReport(req, res) {
  try {
    const { from, to, format } = req.query;
    const data = await reportsRepository.listPurchaseReport({ from, to });
    if (format === "csv") {
      const filename = `laporan-pembelian_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      return sendCsv(res, filename, data, PURCHASE_CSV_COLUMNS);
    }
    const summary = data.reduce(
      (acc, r) => {
        acc.total_qty += Number(r.qty);
        acc.total_value += Number(r.subtotal);
        acc.purchase_ids.add(r.purchase_id);
        return acc;
      },
      { total_qty: 0, total_value: 0, purchase_ids: new Set() }
    );
    return res.json({
      data,
      summary: {
        total_qty: summary.total_qty,
        total_value: summary.total_value,
        total_purchases: summary.purchase_ids.size,
        total_items: data.length,
      },
    });
  } catch (err) {
    console.error("[POS-REPORT] purchases error:", err.message);
    return res.status(500).json({ error: "Gagal memuat laporan pembelian" });
  }
}

module.exports = { getSalesReport, getPurchaseReport };
