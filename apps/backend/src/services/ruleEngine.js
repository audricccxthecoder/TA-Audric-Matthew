// =================================================================
// ruleEngine.js — Lapisan 1 (service layer) implementasi 5 rule
// =================================================================
// Tujuan: pre-check rule SEBELUM masuk ke database, plus mapping dari
// SQLSTATE custom (yang dilempar trigger di Layer 2) ke pesan user-friendly.
//
// R1: Pencegahan Stok Negatif
// R2: Validasi Stok Masuk (purchases) — dipakai oleh purchasesService
// R3: Pembaruan Stok Terpusat (BEFORE UPDATE products) — dijaga DB
// R4: Konsistensi Stok (AFTER INSERT items) — dijalankan trigger DB
// R5: Rekomendasi Restock — read-only view
// =================================================================

// SQLSTATE custom yang dipakai migrasi 006_triggers_R3_R4.sql
const SQLSTATE_R1 = "45R01";
const SQLSTATE_R3 = "45R03";

// R1 pre-check: cek stok cukup untuk SELURUH item (batch). Kembalikan
// daftar item yang gagal — caller yang memutuskan log REJECTED & HTTP 409.
function checkR1StockAvailability({ items, products }) {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const failures = [];

  for (const item of items) {
    const product = productMap.get(item.product_id);

    if (!product) {
      failures.push({
        product_id: item.product_id,
        reason: `Produk ${item.product_id} tidak ditemukan`,
      });
      continue;
    }
    if (product.status !== "aktif") {
      failures.push({
        product_id: item.product_id,
        nama_barang: product.nama_barang,
        reason: `Produk "${product.nama_barang}" sudah nonaktif`,
      });
      continue;
    }
    if (product.stok < item.qty) {
      failures.push({
        product_id: item.product_id,
        nama_barang: product.nama_barang,
        stok_tersedia: product.stok,
        qty_diminta: item.qty,
        reason: `Stok tidak mencukupi untuk "${product.nama_barang}": request ${item.qty} unit, tersedia ${product.stok} unit`,
      });
    }
  }

  return failures;
}

// R2 pre-check: validasi payload commit pembelian.
// SYSTEM PROMPT: status_validasi WAJIB 'tervalidasi' (di-set client setelah konfirmasi)
// dan setiap baris item WAJIB punya product_id (tidak boleh draft kosong).
function checkR2PurchaseValidation({ status_validasi, items }) {
  if (status_validasi !== "tervalidasi") {
    return {
      ok: false,
      reason:
        "R2: stok masuk belum dikonfirmasi user. status_validasi harus 'tervalidasi'",
    };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return {
      ok: false,
      reason: "R2: minimal 1 item harus divalidasi sebelum disimpan",
    };
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.product_id || typeof it.product_id !== "string") {
      return {
        ok: false,
        reason: `R2: item baris #${i + 1} belum dipilih product_id (wajib pilih kandidat dari katalog)`,
      };
    }
    if (!Number.isInteger(it.qty) || it.qty <= 0) {
      return {
        ok: false,
        reason: `R2: item baris #${i + 1} qty harus bilangan bulat > 0`,
      };
    }
    if (typeof it.harga_beli !== "number" || it.harga_beli < 0) {
      return {
        ok: false,
        reason: `R2: item baris #${i + 1} harga_beli harus angka >= 0`,
      };
    }
    if (
      it.diskon_persen != null &&
      (typeof it.diskon_persen !== "number" ||
        it.diskon_persen < 0 ||
        it.diskon_persen > 100)
    ) {
      return {
        ok: false,
        reason: `R2: item baris #${i + 1} diskon_persen harus 0-100`,
      };
    }
  }
  return { ok: true };
}

// Map error dari supabase.rpc() ke HTTP status + pesan ID
function mapDbErrorToHttp(err) {
  if (err?.code === SQLSTATE_R1) {
    return {
      status: 409,
      rule: "R1",
      message: err.message?.replace(/^R1:\s*/, "") || "Stok tidak mencukupi",
    };
  }
  if (err?.code === SQLSTATE_R3) {
    return {
      status: 500,
      rule: "R3",
      message:
        "Pelanggaran aturan integritas stok (R3): perubahan stok tidak diizinkan dari jalur ini",
    };
  }
  return {
    status: 500,
    rule: null,
    message: err?.message || "Gagal memproses transaksi",
  };
}

module.exports = {
  checkR1StockAvailability,
  checkR2PurchaseValidation,
  mapDbErrorToHttp,
  SQLSTATE_R1,
  SQLSTATE_R3,
};
