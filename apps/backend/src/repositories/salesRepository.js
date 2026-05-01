const supabase = require("../config/supabase");

// Panggil function plpgsql fn_create_sale (lihat migrasi 008).
// Function ini berjalan dalam SATU transaksi: jika trigger R1/R3 RAISE EXCEPTION,
// seluruh INSERT di-ROLLBACK otomatis.
async function createSaleViaRpc({ userId, kodeTransaksi, items }) {
  const { data, error } = await supabase.rpc("fn_create_sale", {
    p_user_id: userId,
    p_kode_transaksi: kodeTransaksi,
    p_items: items,
  });

  if (error) {
    // Lempar object berisi metadata SQLSTATE supaya service layer bisa map ke HTTP code
    const err = new Error(error.message);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    throw err;
  }
  return data;
}

// Ambil receipt lengkap (header + item + nama produk) untuk respons POST /api/sales
async function getReceipt(saleId) {
  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .select("id, kode_transaksi, user_id, total_harga, created_at")
    .eq("id", saleId)
    .single();
  if (saleErr) throw new Error("Gagal memuat header transaksi");

  const { data: items, error: itemsErr } = await supabase
    .from("sale_items")
    .select(
      "id, product_id, qty, harga_satuan, subtotal, products(kode_barang, nama_barang, merk)"
    )
    .eq("sale_id", saleId)
    .order("created_at", { ascending: true });
  if (itemsErr) throw new Error("Gagal memuat detail transaksi");

  return {
    ...sale,
    items: items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      kode_barang: it.products?.kode_barang,
      nama_barang: it.products?.nama_barang,
      merk: it.products?.merk,
      qty: it.qty,
      harga_satuan: Number(it.harga_satuan),
      subtotal: Number(it.subtotal),
    })),
  };
}

// Listing untuk GET /api/sales
async function list({ from, to, limit = 50 }) {
  let query = supabase
    .from("sales")
    .select("id, kode_transaksi, user_id, total_harga, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) throw new Error("Gagal memuat daftar transaksi");
  return data || [];
}

module.exports = { createSaleViaRpc, getReceipt, list };
