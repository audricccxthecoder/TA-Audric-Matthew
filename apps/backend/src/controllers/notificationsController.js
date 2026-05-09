// =================================================================
// notificationsController.js — Notifikasi runtime untuk badge sidebar
// =================================================================
// Saat ini hanya 1 jenis notifikasi: barang dengan stok <= min_stock.
// Endpoint dipakai AdminLayout (polling 60 detik) di sisi admin & kasir.
// Tidak menyentuh tabel/tabel baru — query langsung ke products.
// =================================================================

const supabase = require("../config/supabase");

// GET /api/notifications/low-stock
// Response: { count, items: [{id, kode_barang, nama_barang, stok, min_stock, level}] (top 5 paling kritis) }
async function getLowStockNotifications(req, res) {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, kode_barang, nama_barang, merk, stok, min_stock")
      .eq("status", "aktif")
      .order("stok", { ascending: true })
      .limit(500); // safety cap — toko kecil, tidak akan punya 500 produk aktif
    if (error) throw error;

    const flagged = (data || []).filter(
      (p) => Number(p.stok) <= Number(p.min_stock)
    );

    // Urut: stok=0 dulu, lalu kekurangan terbesar
    flagged.sort((a, b) => {
      if (a.stok === 0 && b.stok !== 0) return -1;
      if (b.stok === 0 && a.stok !== 0) return 1;
      const gapA = Number(a.min_stock) - Number(a.stok);
      const gapB = Number(b.min_stock) - Number(b.stok);
      return gapB - gapA;
    });

    const items = flagged.slice(0, 5).map((p) => ({
      id: p.id,
      kode_barang: p.kode_barang,
      nama_barang: p.nama_barang,
      merk: p.merk,
      stok: Number(p.stok),
      min_stock: Number(p.min_stock),
      level: p.stok === 0 ? "habis" : "menipis",
    }));

    res.json({
      count: flagged.length,
      items,
    });
  } catch (err) {
    console.error("[POS-NOTIF] low-stock error:", err.message);
    res.status(500).json({ error: "Gagal memuat notifikasi" });
  }
}

module.exports = { getLowStockNotifications };
