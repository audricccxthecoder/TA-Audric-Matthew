// =================================================================
// restockRepository.js — Akses view v_restock_recommendation (R5)
// =================================================================
// View dibuat di migrasi 007_view_R5.sql, di-extend di 010_view_R5_avg_sales.sql
// dengan kolom avg_sales_30d, total_sold_30d, n_transactions_30d, estimasi_hari_habis.
// =================================================================

const supabase = require("../config/supabase");

// SELECT * FROM v_restock_recommendation (sudah pre-sorted urgensi → kekurangan)
async function listRestockRecommendations() {
  const { data, error } = await supabase
    .from("v_restock_recommendation")
    .select(
      "id, kode_barang, nama_barang, merk, stok, min_stock, kekurangan, tingkat_urgensi, harga_beli, harga_jual, status, avg_sales_30d, total_sold_30d, n_transactions_30d, estimasi_hari_habis"
    );

  if (error) {
    console.error("[POS-RESTOCK-REPO] list error:", error.message);
    throw new Error("Gagal memuat rekomendasi restock");
  }
  // View sudah ORDER BY tingkat urgensi + kekurangan.
  return data || [];
}

module.exports = { listRestockRecommendations };
