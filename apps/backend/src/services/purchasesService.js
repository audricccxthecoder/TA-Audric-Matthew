// =================================================================
// purchasesService.js — Orkestrator OCR + Validasi + Commit Pembelian
// =================================================================
// Pertemuan 8: jalur nota CETAK (sharp + tesseract).
// Pertemuan 9: tambah jalur TULISAN TANGAN (opencv4nodejs) + 4 Strategi
//              mitigasi (sub-bab 3.2.6.4):
//   - Strategi 1: Klasifikasi awal jenis nota (cetak / tulisan_tangan / ambigu)
//   - Strategi 2: Pipeline preprocessing bersyarat (sharp vs opencv)
//   - Strategi 3: Ambang confidence berbeda (60 cetak vs 45 tulisan tangan)
//   - Strategi 4: Fallback agresif ke input manual jika kualitas terlalu rendah
//
// Alur Gambar 3.6 di laporan:
//   1. POST /api/purchases/ocr  — upload file → simpan Storage → klasifikasi →
//      preprocessing → tesseract → parse field → Levenshtein top-3 → return
//      draft 'unsaved'  ATAU  status 'ambiguous_classification'  ATAU
//      'manual_input_required'
//   2. POST /api/purchases/commit — payload tervalidasi user → R2 check →
//      RPC fn_commit_purchase (atomik). Trigger R4 menambah stok + log.
// =================================================================

const ocrService = require("./ocrService");
const notaClassifier = require("./notaClassifierService");
const stringMatcher = require("./stringMatchingService");
const ruleEngine = require("./ruleEngine");
const purchaseRepository = require("../repositories/purchaseRepository");
const stockLogRepository = require("../repositories/stockLogRepository");

// Strategi 4 — ambang fallback (untuk jalur tulisan tangan).
const STRAT4_EMPTY_FIELD_PCT = 0.4; // > 40% field kosong → fallback
const STRAT4_AVG_CONFIDENCE_MIN = 30; // avg confidence < 30 → fallback

// Hitung statistik untuk Strategi 4: persentase field kosong & avg confidence keseluruhan.
function computeOcrQualityStats(items) {
  if (!items || items.length === 0) {
    return { empty_pct: 1, avg_confidence: 0, total_fields: 0 };
  }
  const FIELDS = ["kode_barang", "nama_barang", "qty", "harga_beli"];
  let totalFields = 0;
  let emptyFields = 0;
  let confSum = 0;
  let confCount = 0;
  for (const it of items) {
    for (const f of FIELDS) {
      totalFields++;
      const v = it.raw?.[f];
      if (v === undefined || v === null || v === "" || v === 0) emptyFields++;
      const c = it.confidence?.[f];
      if (typeof c === "number" && c > 0) {
        confSum += c;
        confCount++;
      }
    }
  }
  return {
    empty_pct: totalFields > 0 ? emptyFields / totalFields : 1,
    avg_confidence: confCount > 0 ? confSum / confCount : 0,
    total_fields: totalFields,
  };
}

// Validasi nilai nota_type yang diterima dari client/auto-classify.
function normalizeNotaType(t) {
  if (t === "cetak" || t === "tulisan_tangan") return t;
  return null;
}

// ---------- /api/purchases/ocr ----------
// Body field: file (multipart) + opsional no_nota_supplier + opsional nota_type.
// nota_type: 'cetak' | 'tulisan_tangan' | undefined → auto-classify.
async function processOcr({ user, file, noNotaSupplier, notaType }) {
  if (!file || !file.buffer) {
    const e = new Error("File nota wajib diunggah");
    e.status = 400;
    throw e;
  }

  // (a) Simpan file ke Supabase Storage. File tetap disimpan walau OCR
  // nantinya gagal/fallback — penting untuk audit (Strategi 4).
  const filePath = await purchaseRepository.uploadNota({
    userId: user.id,
    originalName: file.originalname,
    mimetype: file.mimetype,
    buffer: file.buffer,
  });
  const signedUrl = await purchaseRepository.createNotaSignedUrl(filePath);

  // (b) STRATEGI 1 — klasifikasi awal jika user belum override.
  let resolvedType = normalizeNotaType(notaType);
  let classification = null;
  if (!resolvedType) {
    try {
      classification = await notaClassifier.classifyNota(file.buffer);
    } catch (err) {
      console.warn("[POS-OCR] classifier error:", err.message);
      classification = { type: "ambigu", features: { error: err.message } };
    }

    if (classification.type === "ambigu") {
      // Stop di sini — frontend akan tampilkan radio button untuk konfirmasi.
      console.log(
        `[POS-OCR] User=${user.username} klasifikasi=AMBIGU → minta konfirmasi user`
      );
      return {
        status: "ambiguous_classification",
        file_nota_url: filePath,
        file_nota_signed_url: signedUrl,
        no_nota_supplier: noNotaSupplier || null,
        classification,
        message:
          "Sistem tidak yakin jenis nota ini. Mohon pilih: cetak komputer atau tulisan tangan.",
      };
    }
    resolvedType = classification.type;
  }

  // (c) STRATEGI 2 — pipeline bersyarat
  let ocrResult;
  try {
    if (resolvedType === "tulisan_tangan") {
      ocrResult = await ocrService.recognizeHandwrittenReceipt(file.buffer);
    } else {
      ocrResult = await ocrService.recognizePrintedReceipt(file.buffer);
    }
  } catch (err) {
    // OCV_NOT_AVAILABLE: opencv4nodejs belum ter-install / build gagal.
    // Sesuai semangat Strategi 4 → fallback ke input manual.
    if (err.code === "OCV_NOT_AVAILABLE" && resolvedType === "tulisan_tangan") {
      console.warn("[POS-OCR] opencv unavailable → fallback ke manual input");
      return {
        status: "manual_input_required",
        file_nota_url: filePath,
        file_nota_signed_url: signedUrl,
        no_nota_supplier: noNotaSupplier || null,
        nota_type: resolvedType,
        classification,
        reason:
          "Modul OCR tulisan tangan (opencv4nodejs) belum siap. Silakan input manual sementara.",
        items: [],
      };
    }
    console.error("[POS-OCR] recognize error:", err.message);
    const e = new Error("Gagal memproses OCR pada file nota");
    e.status = 500;
    throw e;
  }

  // (d) STRATEGI 4 — fallback agresif untuk tulisan tangan kualitas rendah
  const quality = computeOcrQualityStats(ocrResult.items);
  if (
    resolvedType === "tulisan_tangan" &&
    (quality.empty_pct > STRAT4_EMPTY_FIELD_PCT ||
      quality.avg_confidence < STRAT4_AVG_CONFIDENCE_MIN)
  ) {
    console.warn(
      `[POS-OCR] Strategi 4 fallback: empty_pct=${quality.empty_pct.toFixed(2)} avg_conf=${quality.avg_confidence.toFixed(1)}`
    );
    return {
      status: "manual_input_required",
      file_nota_url: filePath,
      file_nota_signed_url: signedUrl,
      no_nota_supplier: noNotaSupplier || null,
      nota_type: resolvedType,
      classification,
      preprocessing: ocrResult.preprocessing,
      raw_text: ocrResult.raw_text,
      quality,
      reason:
        "Kualitas hasil OCR terlalu rendah untuk divalidasi. Silakan input manual.",
      items: [], // dosen wajib input dari nol — tapi raw_text tetap dikirim untuk referensi
    };
  }

  // (e) Levenshtein matching: untuk tiap item OCR, cari top-3 candidate
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
    `[POS-OCR] User=${user.username} type=${resolvedType} processed nota=${noNotaSupplier || "(tanpa nomor)"} → ${itemsWithCandidates.length} item (avg_conf=${quality.avg_confidence.toFixed(1)}, empty=${(quality.empty_pct * 100).toFixed(0)}%)`
  );

  return {
    status: "unsaved",
    file_nota_url: filePath,
    file_nota_signed_url: signedUrl,
    no_nota_supplier: noNotaSupplier || null,
    nota_type: resolvedType,
    classification,
    raw_text: ocrResult.raw_text,
    preprocessing: ocrResult.preprocessing,
    quality,
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
