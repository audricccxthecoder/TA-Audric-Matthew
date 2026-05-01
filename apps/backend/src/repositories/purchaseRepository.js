const supabase = require("../config/supabase");

const NOTA_BUCKET = "nota-supplier";
const SIGNED_URL_EXPIRY_SEC = 60 * 60 * 24 * 7; // 7 hari

// Upload buffer ke Supabase Storage bucket 'nota-supplier'.
// Return path penyimpanan (BUKAN signed URL — biar bisa di-resign saat preview).
async function uploadNota({ userId, originalName, mimetype, buffer }) {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase();
  const ts = Date.now();
  const path = `${userId}/${ts}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(NOTA_BUCKET)
    .upload(path, buffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) {
    console.error("[POS-PURREPO] uploadNota error:", error.message);
    throw new Error("Gagal mengunggah file nota");
  }
  return path;
}

// Buat signed URL untuk preview di frontend (private bucket)
async function createNotaSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(NOTA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SEC);
  if (error) {
    console.error("[POS-PURREPO] createSignedUrl error:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

// Panggil function plpgsql fn_commit_purchase (lihat migrasi 009).
async function commitPurchaseViaRpc({ userId, noNotaSupplier, fileNotaUrl, items }) {
  const { data, error } = await supabase.rpc("fn_commit_purchase", {
    p_user_id: userId,
    p_no_nota_supplier: noNotaSupplier,
    p_file_nota_url: fileNotaUrl,
    p_items: items,
  });

  if (error) {
    const err = new Error(error.message);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    throw err;
  }
  return data;
}

// Detail header + items untuk response /commit
async function getPurchaseDetail(purchaseId) {
  const { data: purchase, error: pErr } = await supabase
    .from("purchases")
    .select(
      "id, no_nota_supplier, user_id, total, status_validasi, file_nota_url, created_at"
    )
    .eq("id", purchaseId)
    .single();
  if (pErr) throw new Error("Gagal memuat header pembelian");

  const { data: items, error: iErr } = await supabase
    .from("purchase_items")
    .select(
      "id, product_id, qty, harga_beli, diskon_persen, source, products(kode_barang, nama_barang, merk)"
    )
    .eq("purchase_id", purchaseId);
  if (iErr) throw new Error("Gagal memuat detail pembelian");

  return {
    ...purchase,
    file_nota_signed_url: await createNotaSignedUrl(purchase.file_nota_url),
    items: items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      kode_barang: it.products?.kode_barang,
      nama_barang: it.products?.nama_barang,
      merk: it.products?.merk,
      qty: it.qty,
      harga_beli: Number(it.harga_beli),
      diskon_persen: Number(it.diskon_persen),
      source: it.source,
    })),
  };
}

// List untuk GET /api/purchases
async function list({ from, to, limit = 50 }) {
  let query = supabase
    .from("purchases")
    .select(
      "id, no_nota_supplier, user_id, total, status_validasi, file_nota_url, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) throw new Error("Gagal memuat daftar pembelian");
  return data || [];
}

// Catalog produk aktif untuk Levenshtein matching
async function listActiveProductsForMatching() {
  const { data, error } = await supabase
    .from("products")
    .select("id, kode_barang, nama_barang, merk, harga_beli")
    .eq("status", "aktif");
  if (error) {
    console.error("[POS-PURREPO] listActiveProductsForMatching:", error.message);
    throw new Error("Gagal memuat katalog produk");
  }
  return data || [];
}

module.exports = {
  uploadNota,
  createNotaSignedUrl,
  commitPurchaseViaRpc,
  getPurchaseDetail,
  list,
  listActiveProductsForMatching,
  NOTA_BUCKET,
};
