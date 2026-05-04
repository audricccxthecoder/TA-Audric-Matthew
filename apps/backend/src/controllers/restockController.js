// =================================================================
// restockController.js — R5 Rekomendasi Restock (read-only rule)
// =================================================================
// Endpoint admin-only. View v_restock_recommendation dipanggil via repository.
// =================================================================

const restockRepository = require("../repositories/restockRepository");

// GET /api/restock
async function getRestockRecommendations(req, res) {
  try {
    const data = await restockRepository.listRestockRecommendations();

    // Hitung ringkasan per tingkat urgensi (untuk badge di header halaman)
    const summary = data.reduce(
      (acc, r) => {
        acc.total++;
        if (r.tingkat_urgensi === "HABIS") acc.habis++;
        else if (r.tingkat_urgensi === "KRITIS") acc.kritis++;
        else acc.menipis++;
        return acc;
      },
      { total: 0, habis: 0, kritis: 0, menipis: 0 }
    );

    return res.json({
      data,
      summary,
      meta: {
        rule: "R5",
        description:
          "Rekomendasi Restock — barang aktif dengan stok <= min_stock. min_stock di-set manual oleh admin.",
      },
    });
  } catch (err) {
    console.error("[POS-RESTOCK] list error:", err.message);
    return res.status(500).json({ error: err.message || "Gagal memuat rekomendasi restock" });
  }
}

module.exports = { getRestockRecommendations };
