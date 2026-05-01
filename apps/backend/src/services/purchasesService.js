// =================================================================
// purchasesService.js — Orkestrator OCR + Validasi + Commit Pembelian
// =================================================================
// Alur Gambar 3.6 di laporan (jalur nota CETAK KOMPUTER untuk Pertemuan 8):
//   1. POST /api/purchases/ocr  — upload file → simpan Storage → preprocessing
//      → tesseract → parse field → Levenshtein top-3 → return draft 'unsaved'
//   2. POST /api/purchases/commit — payload tervalidasi user → R2 check →
//      RPC fn_commit_purchase (atomik). Trigger R4 menambah stok + log.
// =================================================================

const ocrService = require("./ocrService");
const stringMatcher = require("./stringMatchingService");
const ruleEngine = require("./ruleEngine");
const purchaseRepository = require("../repositories/purchaseRepository");
const stockLogRepository = require("../repositories/stockLogRepository");

// ---------- /api/purchases/ocr ----------
async function processOcr({ user, file, noNotaSupplier }) {
  if (!file || !file.buffer) {
    const e = new Error("File nota wajib diunggah");
    e.status = 400;
    throw e;
  }

  // (a) Simpan file ke Supabase Storage (jalur cetak: image only — JPG/PNG/WebP)
  const filePath = await purchaseRepository.uploadNota({
    userId: user.id,
    originalName: file.originalname,
    mimetype: file.mimetype,
    buffer: file.buffer,
  });
  const signedUrl = await purchaseRepository.createNotaSignedUrl(filePath);

  // (b) Pipeline preprocessing CETAK + OCR
  let ocrResult;
  try {
    ocrResult = await ocrService.recognizePrintedReceipt(file.buffer);
  } catch (err) {
    console.error("[POS-OCR] recognize error:", err.message);
    const e = new Error("Gagal memproses OCR pada file nota");
    e.status = 500;
    throw e;
  }

  // (c) Levenshtein matching: untuk tiap item OCR, cari top-3 candidate
  const catalog = await purchaseRepository.listActiveProductsForMatching();
  const itemsWithCandidates = ocrResult.items.map((item, idx) => ({
    index: idx,
    raw: item.raw,
    confidence: item.confidence,
    confidence_avg: item.confidence_avg,
    low_confidence: item.low_confidence,
    line_text: item.line_text,
    candidates: stringMatcher.findTopCandidates({
      ocrName: item.raw.nama_barang,
      ocrKode: item.raw.kode_barang,
      products: catalog,
      topN: 3,
    }),
  }));

  console.log(
    `[POS-OCR] User=${user.username} processed nota=${noNotaSupplier || "(tanpa nomor)"} → ${itemsWithCandidates.length} item terdeteksi`
  );

  return {
    status: "unsaved",
    file_nota_url: filePath, // path internal storage (bukan public URL)
    file_nota_signed_url: signedUrl, // untuk preview di frontend
    no_nota_supplier: noNotaSupplier || null,
    raw_text: ocrResult.raw_text,
    preprocessing: ocrResult.preprocessing,
    items: itemsWithCandidates,
  };
}

// ---------- /api/purchases/commit ----------
async function commitPurchase({ user, payload }) {
  const {
    no_nota_supplier,
    file_nota_url,
    status_validasi,
    items,
  } = payload || {};

  // R2 LAYER 1: validasi konfirmasi user + bentuk payload
  const r2 = ruleEngine.checkR2PurchaseValidation({ status_validasi, items });
  if (!r2.ok) {
    // Audit R2 REJECTED — stok belum berubah, tetap dicatat untuk forensik
    await stockLogRepository.write({
      product_id: null,
      user_id: user.id,
      source_type: "purchase",
      rule_triggered: "R2",
      rule_action: "REJECTED",
      reason_detail: r2.reason,
      context_payload: { payload },
    });
    const e = new Error(r2.reason);
    e.status = 400;
    e.rule = "R2";
    throw e;
  }

  // Normalisasi item agar fn_commit_purchase menerima tipe konsisten
  const normalizedItems = items.map((it) => ({
    product_id: it.product_id,
    qty: Number(it.qty),
    harga_beli: Number(it.harga_beli),
    diskon_persen: Number(it.diskon_persen ?? 0),
    source: it.source === "ocr" ? "ocr" : "manual",
  }));

  // RPC atomik: INSERT purchases + INSERT purchase_items.
  // Trigger R4 (fn_purchase_items_apply) menambah products.stok + tulis stock_logs ACCEPTED.
  let rpcResult;
  try {
    rpcResult = await purchaseRepository.commitPurchaseViaRpc({
      userId: user.id,
      noNotaSupplier: no_nota_supplier || null,
      fileNotaUrl: file_nota_url || null,
      items: normalizedItems,
    });
  } catch (err) {
    const mapped = ruleEngine.mapDbErrorToHttp(err);
    if (mapped.rule === "R3") {
      await stockLogRepository.write({
        product_id: null,
        user_id: user.id,
        source_type: "purchase",
        rule_triggered: "R3",
        rule_action: "TRIGGERED",
        reason_detail: mapped.message,
        context_payload: { payload },
      });
    }
    const e = new Error(mapped.message);
    e.status = mapped.status;
    e.rule = mapped.rule;
    throw e;
  }

  const detail = await purchaseRepository.getPurchaseDetail(rpcResult.purchase_id);
  console.log(
    `[POS-PURCHASES] Commit purchase_id=${rpcResult.purchase_id} oleh user=${user.username} total=${rpcResult.total} (${normalizedItems.length} item)`
  );
  return detail;
}

async function listPurchases(filter) {
  return purchaseRepository.list(filter);
}

module.exports = { processOcr, commitPurchase, listPurchases };
