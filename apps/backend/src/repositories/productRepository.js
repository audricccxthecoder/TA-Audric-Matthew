const supabase = require("../config/supabase");

// Ambil banyak produk berdasarkan id (untuk R1 pre-check di salesService)
async function findByIds(ids) {
  const { data, error } = await supabase
    .from("products")
    .select("id, kode_barang, nama_barang, merk, harga_jual, stok, status")
    .in("id", ids);

  if (error) {
    console.error("[POS-PRODREPO] findByIds error:", error.message);
    throw new Error("Gagal memuat produk");
  }
  return data || [];
}

// Pencarian produk untuk halaman /kasir (search-on-type)
async function search({ q = "", limit = 20 }) {
  let query = supabase
    .from("products")
    .select("id, kode_barang, nama_barang, merk, harga_jual, stok, min_stock, status")
    .eq("status", "aktif")
    .order("nama_barang", { ascending: true })
    .limit(limit);

  if (q && q.trim()) {
    const term = q.trim();
    // ILIKE pada nama_barang ATAU kode_barang (parameterized otomatis oleh supabase-js)
    query = query.or(`nama_barang.ilike.%${term}%,kode_barang.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[POS-PRODREPO] search error:", error.message);
    throw new Error("Gagal mencari produk");
  }
  return data || [];
}

module.exports = { findByIds, search };
