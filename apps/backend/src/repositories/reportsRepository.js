const supabase = require("../config/supabase");

// Sales report — flatten ke level item supaya tabel detail per-item langsung dapat
async function listSalesReport({ from = null, to = null, limit = 5000 }) {
  let query = supabase
    .from("sale_items")
    .select(
      "id, qty, harga_satuan, subtotal, created_at, sale_id, product_id, sales!inner(kode_transaksi, total_harga, created_at, user_id, users(username)), products(kode_barang, nama_barang, merk)"
    )
    .order("sale_id", { ascending: false })
    .limit(limit);

  if (from) query = query.gte("sales.created_at", from);
  if (to) query = query.lte("sales.created_at", to);

  const { data, error } = await query;
  if (error) {
    console.error("[POS-REPORT] sales error:", error.message);
    throw new Error("Gagal memuat laporan penjualan");
  }

  return (data || []).map((r) => ({
    sale_item_id: r.id,
    sale_id: r.sale_id,
    kode_transaksi: r.sales?.kode_transaksi,
    sale_created_at: r.sales?.created_at,
    sale_total: Number(r.sales?.total_harga || 0),
    kasir: r.sales?.users?.username || null,
    product_id: r.product_id,
    kode_barang: r.products?.kode_barang,
    nama_barang: r.products?.nama_barang,
    merk: r.products?.merk,
    qty: r.qty,
    harga_satuan: Number(r.harga_satuan),
    subtotal: Number(r.subtotal),
  }));
}

// Purchase report — flatten purchase_items
async function listPurchaseReport({ from = null, to = null, limit = 5000 }) {
  let query = supabase
    .from("purchase_items")
    .select(
      "id, qty, harga_beli, diskon_persen, source, purchase_id, product_id, purchases!inner(no_nota_supplier, status_validasi, total, created_at, user_id, users(username)), products(kode_barang, nama_barang, merk)"
    )
    .order("purchase_id", { ascending: false })
    .limit(limit);
  if (from) query = query.gte("purchases.created_at", from);
  if (to) query = query.lte("purchases.created_at", to);

  const { data, error } = await query;
  if (error) {
    console.error("[POS-REPORT] purchases error:", error.message);
    throw new Error("Gagal memuat laporan pembelian");
  }

  return (data || []).map((r) => ({
    purchase_item_id: r.id,
    purchase_id: r.purchase_id,
    no_nota: r.purchases?.no_nota_supplier,
    purchase_created_at: r.purchases?.created_at,
    purchase_total: Number(r.purchases?.total || 0),
    status_validasi: r.purchases?.status_validasi,
    user: r.purchases?.users?.username || null,
    product_id: r.product_id,
    kode_barang: r.products?.kode_barang,
    nama_barang: r.products?.nama_barang,
    merk: r.products?.merk,
    qty: r.qty,
    harga_beli: Number(r.harga_beli),
    diskon_persen: Number(r.diskon_persen),
    source: r.source,
    subtotal: Number(r.harga_beli) * Number(r.qty) * (1 - Number(r.diskon_persen) / 100),
  }));
}

module.exports = { listSalesReport, listPurchaseReport };
