// =================================================================
// ocrService.js — Pipeline OCR (jalur CETAK + jalur TULISAN TANGAN)
// =================================================================
// Strategi 2 (Pipeline Preprocessing Bersyarat) — sub-bab 3.2.6.4:
//
//   JALUR CETAK (sharp) — multi-pass:
//     PASS 1 "gentle" (default — biarkan tesseract internal binarize):
//       1. Upscale ke ~2400px width (tesseract optimal di ~300 DPI;
//          foto HP umumnya 1500-2000px → upscale lanczos3)
//       2. Grayscale + normalize (auto-contrast)
//       3. Linear contrast boost (1.25, -20)
//       4. Sharpen ringan (sigma 0.5)
//     PASS 2 "aggressive" (fallback kalau pass 1 balas <= 1 item):
//       1. Upscale ke 2400px
//       2. Grayscale + normalize
//       3. Median blur kernel 3
//       4. Otsu thresholding (binarisasi keras)
//     Plus: tesseract PSM=6 (single uniform block) + preserve_interword_spaces.
//
//   JALUR TULISAN TANGAN (opencv4nodejs):
//     1. cv.cvtColor(BGR→GRAY)
//     2. cv.adaptiveThreshold(255, GAUSSIAN_C, BINARY, 11, 2)
//     3. cv.bilateralFilter(9, 75, 75)
//     4. Deskew per-baris (deteksi baris via projection profile,
//        hitung angle via minAreaRect contour, rotate per-line region)
//     5. cv.dilate(kernel 2x2, iterations=1) — dilatasi morfologis ringan
//
// Setelah preprocessing → tesseract.js dengan trained data 'ind+eng'.
// Hasil di-parse via regex untuk field: kode_barang, nama_barang, qty,
// harga_beli, diskon_persen.
//
// STRATEGI 3 — ambang confidence:
//   - cetak: terima field jika rata-rata confidence kata >= 60
//   - tulisan_tangan: terima jika >= 45 (lebih longgar)
// =================================================================

const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

// opencv4nodejs lazy-load: kalau native build gagal di Windows, jangan
// crash boot server. Pipeline tulisan tangan akan throw error spesifik
// yang ditangkap purchasesService → fallback Strategi 4 manual_input.
let _cv = null;
let _cvLoadError = null;
function getCv() {
  if (_cv) return _cv;
  if (_cvLoadError) throw _cvLoadError;
  try {
    _cv = require("@u4/opencv4nodejs");
    return _cv;
  } catch (err) {
    _cvLoadError = new Error(
      "OCV_NOT_AVAILABLE: modul @u4/opencv4nodejs belum terpasang/ter-build. " +
        "Jalankan `npm install @u4/opencv4nodejs` di apps/backend dan pastikan " +
        "Visual Studio Build Tools (C++ workload) + CMake terpasang. " +
        "Jalur OCR tulisan tangan otomatis fallback ke input manual sampai siap."
    );
    _cvLoadError.code = "OCV_NOT_AVAILABLE";
    throw _cvLoadError;
  }
}

// ---------- 1. Otsu Thresholding manual (sharp tidak punya) ----------
// Input: Buffer raw grayscale 1-channel. Output: nilai threshold 0..255.
function computeOtsuThreshold(rawGreyBuffer) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < rawGreyBuffer.length; i++) {
    histogram[rawGreyBuffer[i]]++;
  }
  const total = rawGreyBuffer.length;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let wB = 0;
  let varMax = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > varMax) {
      varMax = between;
      threshold = t;
    }
  }
  // Sanity clamp: hindari edge case t=0 (sharp.threshold(0) → semua piksel jadi
  // putih) atau t=255 (semua hitam). Untuk gambar bimodal sempurna 0/255, Otsu
  // bisa pilih t=0; clamp ke 127 agar pemisahan tetap masuk akal.
  if (threshold <= 0 || threshold >= 255) {
    threshold = 127;
  }
  return threshold;
}

// ---------- 1b. Deteksi kertas berwarna (carbon paper merah muda, dll) -----
// Sample mean per channel pada thumbnail kecil (cepat). Jika selisih warna > 18
// pada salah satu pasangan kanal → paper berwarna → pipeline khusus.
// Output: { is_colored, dominant_channel, mean_r, mean_g, mean_b }
async function detectPaperColor(inputBuffer) {
  // .rotate() tanpa argumen = auto-orient berdasarkan EXIF tag.
  // Wajib untuk foto langsung dari kamera HP iPhone — raw pixel-nya
  // sering miring meskipun visualnya tegak.
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const totalPx = info.width * info.height;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < data.length; i += channels) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
  }
  const meanR = sumR / totalPx;
  const meanG = sumG / totalPx;
  const meanB = sumB / totalPx;

  // Selisih signifikan antar kanal = kertas/tinta dominan satu warna.
  const dRG = meanR - meanG;
  const dRB = meanR - meanB;
  const dGB = meanG - meanB;
  const isColored =
    Math.abs(dRG) > 18 || Math.abs(dRB) > 18 || Math.abs(dGB) > 18;

  // Pilih channel yang paling "TIDAK MIRIP" warna paper untuk ekstraksi.
  // Pink/merah → paper terang di B+G, gelap di R → ekstrak B (ink hitam tetap gelap, paper jadi terang).
  // Biru carbon → ekstrak R. Hijau → ekstrak R atau B.
  let dominantChannel = "blue";
  if (meanR >= meanG && meanR >= meanB) dominantChannel = "blue"; // R dominan → kertas merah/pink → pakai B
  else if (meanB >= meanR && meanB >= meanG) dominantChannel = "red"; // B dominan → kertas biru → pakai R
  else if (meanG >= meanR && meanG >= meanB) dominantChannel = "red"; // G dominan → pakai R

  return {
    is_colored: isColored,
    dominant_channel: dominantChannel,
    mean_r: Math.round(meanR),
    mean_g: Math.round(meanG),
    mean_b: Math.round(meanB),
  };
}

// ---------- 2. Pipeline preprocessing untuk nota CETAK ----------
// Target width untuk upscaling. Tesseract optimal ~300 DPI. Foto HP umumnya
// 1500-2000px, jadi naikkan ke 2400px supaya font kecil di tabel item kebaca.
const PRINTED_TARGET_WIDTH = 2400;

// Pipeline khusus kertas berwarna (carbon merah muda, biru, dll).
// Ekstrak satu channel (yang paling kontras dengan warna paper), normalize,
// median blur, lalu Otsu binarisasi. Ini fix utama untuk nota carbon
// merah-muda — di grayscale standar tinta hitam dan kertas merah jatuh ke
// abu-abu hampir sama (low contrast).
async function preprocessPrintedColored(inputBuffer, channelName) {
  const meta = await sharp(inputBuffer).rotate().metadata();
  const targetWidth = Math.max(meta.width || 0, PRINTED_TARGET_WIDTH);
  const ch = channelName === "red" ? "red" : channelName === "green" ? "green" : "blue";

  // Step 1: rotate (auto-orient EXIF) → resize → extract single channel → normalize
  const oneChannel = await sharp(inputBuffer)
    .rotate()
    .resize({ width: targetWidth, kernel: "lanczos3", withoutEnlargement: false })
    .extractChannel(ch)
    .normalize()
    .toBuffer();

  // Step 2: hitung Otsu pada raw 1-channel
  const { data: rawCh } = await sharp(oneChannel)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const otsuValue = computeOtsuThreshold(rawCh);

  // Step 3: median blur (buang salt-and-pepper) + threshold
  const processed = await sharp(oneChannel)
    .median(3)
    .threshold(otsuValue)
    .toBuffer();

  return {
    processed,
    otsuValue,
    channel: ch,
    width: meta.width,
    height: meta.height,
    upscaled_to: targetWidth,
  };
}

// Pass 1: gentle pipeline. JANGAN lakukan hard binarization (sharp.threshold)
// — biarkan tesseract internal binarize secara adaptif. Hasilnya lebih bagus
// untuk teks kecil dense (banyak item, font 6-8pt).
async function preprocessPrintedGentle(inputBuffer) {
  const meta = await sharp(inputBuffer).rotate().metadata();
  const targetWidth = Math.max(meta.width || 0, PRINTED_TARGET_WIDTH);

  const processed = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: targetWidth,
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .greyscale()
    .normalize()
    .linear(1.25, -20) // boost kontras lokal
    .sharpen({ sigma: 0.5 }) // sharpen ringan
    .toBuffer();

  return {
    processed,
    width: meta.width,
    height: meta.height,
    upscaled_to: targetWidth,
  };
}

// Pass 2: aggressive pipeline (Otsu binarization). Fallback kalau gentle
// gagal extract item — biasanya untuk nota kontras tinggi sederhana atau
// nota dengan banyak grafik/garis tebal.
async function preprocessPrintedAggressive(inputBuffer) {
  const meta = await sharp(inputBuffer).rotate().metadata();
  const targetWidth = Math.max(meta.width || 0, PRINTED_TARGET_WIDTH);

  const { data: rawGrey } = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: targetWidth,
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const otsuValue = computeOtsuThreshold(rawGrey);

  const processed = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: targetWidth,
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .greyscale()
    .normalize()
    .median(3)
    .threshold(otsuValue)
    .toBuffer();

  return {
    processed,
    otsuValue,
    width: meta.width,
    height: meta.height,
    upscaled_to: targetWidth,
  };
}

// Backward-compat: existing tests/import yang panggil preprocessPrinted langsung
// akan dapat pipeline gentle (default baru).
async function preprocessPrinted(inputBuffer) {
  return preprocessPrintedGentle(inputBuffer);
}

// ---------- 3. Tesseract recognize (worker reusable) ----------
let _worker = null;
let _workerInitPromise = null;

async function getWorker() {
  if (_worker) return _worker;
  if (_workerInitPromise) return _workerInitPromise;

  _workerInitPromise = (async () => {
    console.log("[POS-OCR] Initializing tesseract worker (ind+eng)...");
    const worker = await createWorker("ind+eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && m.progress === 1) {
          console.log(`[POS-OCR] Recognize done (jobId=${m.jobId})`);
        }
      },
    });
    // PSM 6 = single uniform block of text — paling cocok untuk receipt table
    // dengan baris-baris item beraturan. preserve_interword_spaces menjaga
    // gap antar kolom supaya parser regex bisa pisahkan field.
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
    });
    _worker = worker;
    return worker;
  })();

  return _workerInitPromise;
}

// Untuk graceful shutdown (jarang dipakai, opsional)
async function terminateWorker() {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
    _workerInitPromise = null;
  }
}

// ---------- 4. Parser hasil tesseract ----------
// Format target per item nota cetak (typical):
//   "SCM-001  Kampas Rem Beat   3 pcs  Rp 25.000   10%"
// Strategi: per baris, ekstrak field dengan regex; abaikan baris header/total.

// Header tabel + footer + label non-item yang sering muncul di nota Indonesia.
// Baris yang start-with kata-kata ini akan di-skip di parser.
const SKIP_LINE_RE =
  /^(total|sub\s?total|grand\s?total|invoice|nota|tanggal|tgl|tanda\s+terima|hormat|tunai|kembalian|ppn|pajak|diskon\s+total|pot\.?|potongan|biaya|terbilang|disetujui|disiapkan|kepada|alamat|telp\.?|hp|email|kode\s+pel|nama\s+pel|kabag|disetorkan|banyaknya|nama\s+barang|harga\s|jumlah|kode\s|qty\s*$|barang\s*$|merk|satuan|admin|cashier|kasir|no\.?\s*kd|kd\.?\s*item|kd\.?\s*barang|nama\s*item|jml\b|sat\.?\s|pot\s*%|asia\s+jaya|dept|transaksi|s1[-\s]\d|tr\s*:|peja\s*:|hormat\s+kami)/i;

// Pattern untuk pemisah multi-transaksi dalam satu nota (S1-XXXXXXXX).
// OCR sering miss-read 'S1' jadi 'SL', 'Si', 'S|', '51', 'SI'. Pattern
// dibuat fuzzy untuk variasi karakter awal yang lazim di Tesseract.
// Saat ditemukan, parser anggap baris ini header transaksi baru, bukan item.
const TRANSACTION_HEADER_RE = /\b(?:S[1lLI|i!]|51)[-\s]?\d{6,10}\b/;

// Baris hanya berisi tanda baca/garis dekorasi (...) atau angka tunggal.
function isDecorativeLine(text) {
  const stripped = String(text || "").replace(/\s/g, "");
  if (stripped.length < 4) return true;
  // Lebih dari 60% karakter adalah tanda baca/garis → skip
  const punctCount = (stripped.match(/[^a-zA-Z0-9]/g) || []).length;
  if (punctCount / stripped.length > 0.6) return true;
  // Tidak ada huruf sama sekali → skip
  if (!/[a-zA-Z]/.test(stripped)) return true;
  return false;
}

function parseAmount(str) {
  // Heuristik format Indonesia + OCR confusion handling.
  //   "50.000,00"        → 50000     (titik=ribuan, koma=desimal)
  //   "50.000.00"        → 50000     (OCR salah baca koma jadi titik — desimal di akhir)
  //   "1.500.000"        → 1500000   (3 separator semua = ribuan)
  //   "1.500"            → 1500      (1 separator + 3 digit = ribuan)
  //   "1500"             → 1500      (tanpa separator)
  //   "Rp 25,000"        → 25000     (style US: koma ribuan)
  // Pendeteksi desimal: kalau diakhiri "[.,]\d{2}$" DAN ada digit lain sebelumnya,
  // anggap 2 digit terakhir adalah sen → buang.
  const cleaned = String(str).replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  const decimalMatch = cleaned.match(/^(.+)[.,](\d{2})$/);
  if (decimalMatch) {
    const intPart = decimalMatch[1].replace(/[.,]/g, "");
    return parseInt(intPart, 10) || 0;
  }
  return parseInt(cleaned.replace(/[.,]/g, ""), 10) || 0;
}

function avgConfidenceOfWords(words) {
  if (!words || words.length === 0) return 0;
  const sum = words.reduce((s, w) => s + (w.confidence || 0), 0);
  return Math.round(sum / words.length);
}

// Ambil words dari sebuah line yang text-nya match substring tertentu.
function wordsMatching(words, snippet) {
  if (!snippet) return [];
  const tokens = String(snippet)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  return words.filter((w) =>
    tokens.some((t) => String(w.text).toLowerCase().includes(t))
  );
}

// Daftar satuan yang diakui parser. Ditulis terpisah untuk ditest unit.
// Indonesia common: kg, gr, bal, bks, bh, lusin, dus, krg, sak, ekor.
// English/umum: pcs, pc, unit, set, pak, btl, ml, ltr, liter, l, roll.
const UNIT_RE_SRC =
  "pcs?|pc|unit|btl|botol|pak|paket|set|kg|gr|gram|bal|bks|bungkus|bh|buah|lusin|dus|krg|karung|liter|ltr|l|ml|ekor|roll|lbr|lembar|sak|kaleng|kotak|tube|sachet|rim|sht";

function parseLineToItem(line) {
  const text = (line.text || "").trim();
  if (text.length < 6) return null;
  if (SKIP_LINE_RE.test(text)) return null;
  if (TRANSACTION_HEADER_RE.test(text)) return null;
  if (isDecorativeLine(text)) return null;
  // Skip baris yang isinya cuma angka/separator (no letters) — biasanya line total
  if (!/[a-zA-Z]/.test(text)) return null;

  const words = line.words || [];

  // Field qty: prioritas pattern dengan satuan (pcs/kg/dll) karena
  // paling tidak ambigu. Sanity cap: qty > 9999 hampir pasti misread
  // dari nilai harga, jadi ditolak.
  const qtyMatchPriority =
    text.match(new RegExp(`\\b(\\d{1,4})(?:[.,]\\d+)?\\s*(?:${UNIT_RE_SRC})\\b`, "i")) ||
    text.match(/(?:qty|jml|jumlah|jum|banyak)\s*[:.]?\s*(\d{1,4})/i) ||
    text.match(/\b(\d{1,4})\s*x\s/i) ||
    text.match(/^(\d{1,4})\s+[a-zA-Z]/);
  const qtyRaw = qtyMatchPriority ? parseInt(qtyMatchPriority[1], 10) : null;
  const qty = qtyRaw && qtyRaw <= 9999 ? qtyRaw : null;
  const qtyMatch = qtyMatchPriority;

  // Field harga_beli: cari SEMUA angka dengan separator ribuan (≥ 4 digit
  // setelah dibersihkan), lalu pilih yang terbesar. Ini ngalahkan
  // bug column-scrambling di mana qty/harga/total ketukar posisi —
  // harga satuan biasanya angka terbesar yang masuk akal di line item.
  // Pengecualian: kalau ada "Rp"/"IDR" prefix → ambil yang itu langsung.
  let harga_beli = null;
  let hargaMatch = text.match(/(?:rp\.?|idr)\s*([\d.,]+)/i);
  if (hargaMatch) {
    harga_beli = parseAmount(hargaMatch[1]);
  } else {
    // Token format normal (titik/koma separator ribuan)
    const numericTokensDot = text.match(
      /\b\d{1,3}(?:[.,]\d{3}){1,3}(?:[.,]\d{2})?\b/g
    ) || [];
    // Token format space-separator (Tesseract sering baca titik sebagai spasi).
    // Pattern: digit 1-3 + (spasi + digit 3) minimal 1x.
    // Contoh: "320 000" → 320000, "1 800 000" → 1800000.
    const numericTokensSpace = text.match(/\b\d{1,3}(?:\s+\d{3}){1,3}\b/g) || [];
    const numericTokens = [...numericTokensDot, ...numericTokensSpace];
    const numericValues = numericTokens
      .map((t) => parseAmount(t.replace(/\s+/g, ".")))
      .filter((v) => v >= 1000); // harga sparepart minimal 1k
    if (numericValues.length > 0) {
      // Kalau hanya 1 angka → pakai. Kalau banyak (qty/harga/total),
      // ambil MEDIAN supaya tidak terpengaruh outlier (total).
      // Sortir, ambil tengah.
      numericValues.sort((a, b) => a - b);
      // Untuk 3 angka [qty_total, harga, total] median = harga.
      // Untuk 2 angka pilih yang lebih kecil (harga vs total).
      if (numericValues.length >= 3) {
        harga_beli = numericValues[Math.floor(numericValues.length / 2)];
      } else {
        harga_beli = numericValues[0];
      }
      // Bangun stub hargaMatch untuk leftover stripping di bawah
      hargaMatch = { 0: numericTokens.find((t) => parseAmount(t) === harga_beli) || numericTokens[0] };
    }
  }

  // Field diskon_persen: angka diikuti %
  const diskMatch = text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  const diskon_persen = diskMatch
    ? parseFloat(String(diskMatch[1]).replace(",", ".")) || 0
    : 0;

  // Field kode_barang: pattern khas sparepart motor.
  // Contoh real dari nota: 90111-08815, 93306-002YR, SVD-E1310-20,
  // 5TL-E7623-00, BK6-F3145-00, 4YS-E4500-00, 401-16111-00-30, BPNE2228.
  // Aturan: panjang ≥ 5, harus ada minimal 1 digit, boleh ada strip,
  // huruf tidak melebihi 70% (cegah tangkap kata biasa seperti "PIRINGAN").
  let kode_barang = "";
  const kodeCandidates = text.match(/\b[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) || [];
  for (const cand of kodeCandidates) {
    if (cand.length < 5 || cand.length > 22) continue;
    if (!/\d/.test(cand)) continue;
    const letters = (cand.match(/[A-Z]/g) || []).length;
    const total = cand.replace(/-/g, "").length;
    if (letters / total > 0.7) continue;
    // Reject pure numeric tanpa strip (kemungkinan harga/qty)
    if (!cand.includes("-") && !/[A-Z]/.test(cand)) continue;
    kode_barang = cand;
    break;
  }
  const kodeMatch = kode_barang ? { 0: kode_barang } : null;

  // Sisa untuk nama_barang: hilangkan field-field yang sudah ditangkap.
  // Pakai global regex untuk strip SEMUA occurrence harga/qty (bukan cuma yang
  // pertama), karena nota typical menampilkan harga@unit dan total per row.
  let leftover = text;
  if (qtyMatch) leftover = leftover.replace(qtyMatch[0], " ");
  // Strip semua angka berformat ribuan + prefix Rp/IDR + decimal opsional
  leftover = leftover
    .replace(/(?:rp\.?|idr)\s*[\d.,]+/gi, " ")
    .replace(/\b\d{1,3}(?:[.,]\d{3}){1,3}(?:[.,]\d{2})?\b/g, " ");
  if (diskMatch) leftover = leftover.replace(diskMatch[0], " ");
  if (kodeMatch) leftover = leftover.replace(kodeMatch[0], " ");
  const nama_barang = leftover
    .replace(/[^a-zA-Z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Filter baris yang tidak terlihat seperti item (perlu nama + minimal qty atau harga)
  if (!nama_barang || nama_barang.length < 3) return null;
  if (qty === null && harga_beli === null) return null;

  // Confidence per field dari word-level confidence
  const confidence = {
    kode_barang: avgConfidenceOfWords(wordsMatching(words, kode_barang)),
    nama_barang: avgConfidenceOfWords(wordsMatching(words, nama_barang)),
    qty: avgConfidenceOfWords(wordsMatching(words, qty != null ? String(qty) : "")),
    harga_beli: avgConfidenceOfWords(
      wordsMatching(words, hargaMatch ? hargaMatch[0] : "")
    ),
    diskon_persen: avgConfidenceOfWords(
      wordsMatching(words, diskMatch ? diskMatch[0] : "")
    ),
  };

  return {
    raw: {
      kode_barang,
      nama_barang,
      qty: qty || 0,
      harga_beli: harga_beli || 0,
      diskon_persen,
    },
    confidence,
    line_text: text,
  };
}

function parseTesseractData(data) {
  let lines = data?.lines || [];
  // Fallback: tesseract.js v6+ kadang tidak balas struktur lines lengkap saat
  // PSM=6. Pecah data.text per newline secara manual. Word-level confidence
  // hilang untuk line ini → kita seed dengan overall data.confidence supaya
  // parser tetap bisa lapor angka, bukan 0%.
  const overallConf = typeof data?.confidence === "number" ? data.confidence : 0;
  if (lines.length === 0 && typeof data?.text === "string" && data.text.trim()) {
    lines = data.text
      .split(/\r?\n/)
      .map((t) => ({
        text: t,
        // Bikin satu pseudo-word ber-confidence overall, supaya
        // wordsMatching() di parseLineToItem mengembalikan ≥1 word
        // dan avgConfidenceOfWords() balas overallConf, bukan 0.
        words: t.trim()
          ? [{ text: t, confidence: overallConf }]
          : [],
      }))
      .filter((l) => l.text.trim().length > 0);
  }
  const items = [];
  // Multi-transaksi: sebuah nota bisa berisi beberapa transaksi berurutan
  // (S1-25120493, S1-25120494, dst.). Tiap line yang match TRANSACTION_HEADER_RE
  // = pemisah → naikkan transactionIndex. Item yang sudah keluar akan
  // di-tag dengan transactionIndex saat ini.
  let transactionIndex = 0;
  let lastTransactionCode = null;
  for (const line of lines) {
    const text = (line.text || "").trim();
    const trxMatch = text.match(/\b(?:S[1lLI|i!]|51)[-\s]?(\d{6,10})\b/);
    if (trxMatch) {
      // Naikkan index hanya kalau kode transaksi baru (bukan duplikasi OCR)
      const code = trxMatch[0];
      if (code !== lastTransactionCode) {
        if (items.length > 0) transactionIndex++;
        lastTransactionCode = code;
      }
      continue; // baris header, jangan parse jadi item
    }
    const item = parseLineToItem(line);
    if (item) {
      // Annotate dengan overall confidence sebagai cadangan terakhir
      const allZero = Object.values(item.confidence).every((v) => v === 0);
      if (allZero && overallConf > 0) {
        item.confidence = {
          kode_barang: overallConf,
          nama_barang: overallConf,
          qty: overallConf,
          harga_beli: overallConf,
          diskon_persen: overallConf,
        };
      }
      item.transaction_index = transactionIndex;
      item.transaction_code = lastTransactionCode || null;
      items.push(item);
    }
  }
  return items;
}

// ---------- 5. Strategi 3: filter confidence ambang (jalur cetak: 60) ----------
// Item di-flag low_confidence = true kalau rata-rata confidence < 60.
function flagLowConfidence(items, threshold = 60) {
  return items.map((item) => {
    const fields = item.confidence;
    const vals = Object.values(fields).filter((v) => v > 0);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return {
      ...item,
      confidence_avg: Math.round(avg),
      low_confidence: avg < threshold,
    };
  });
}

// ---------- 6a. Entry point CETAK (multi-strategy + multi-PSM) ----------
//
// Strategi pipeline (dipilih otomatis):
//   - Kalau kertas berwarna terdeteksi (mean_R - mean_B > 18 dst.) →
//     pipeline 'colored' (extractChannel → Otsu) sebagai pass 1.
//   - Kalau tidak → pipeline 'gentle' standar.
//   - Selalu coba pipeline 'aggressive' (Otsu global pada grayscale)
//     sebagai fallback bila pass 1 hasil ≤ 1 item.
//
// Untuk tiap pipeline, jalankan tesseract dengan 2 PSM (6 = single block,
// 4 = variable column / multi-column tabular). PSM 4 sering lebih bagus
// untuk nota dengan tabel rapat. Pilih PSM yang menghasilkan item terbanyak.
//
// Skor kualitas: items yang ada minimal kode_barang ATAU dua field numerik
// dihitung sebagai "valid". Pipeline+PSM dengan jumlah valid terbanyak menang.
function countValidItems(items) {
  if (!items) return 0;
  let valid = 0;
  for (const it of items) {
    const r = it.raw || {};
    const hasKode = r.kode_barang && String(r.kode_barang).length >= 5;
    const numericCount =
      (r.qty > 0 ? 1 : 0) + (r.harga_beli > 0 ? 1 : 0);
    if (hasKode || numericCount >= 2) valid++;
  }
  return valid;
}

async function recognizeWithPsm(worker, processedBuffer, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
  });
  const { data } = await worker.recognize(processedBuffer);
  return data;
}

async function tryPipelineMultiPsm(worker, processedBuffer, label) {
  let best = { data: null, items: [], psm: 6, valid: -1 };
  for (const psm of [6, 4]) {
    const data = await recognizeWithPsm(worker, processedBuffer, psm);
    const items = flagLowConfidence(parseTesseractData(data), 60);
    const valid = countValidItems(items);
    console.log(
      `[POS-OCR] ${label} PSM=${psm} → ${items.length} item (${valid} valid)`
    );
    if (valid > best.valid || (valid === best.valid && items.length > best.items.length)) {
      best = { data, items, psm, valid };
    }
  }
  return best;
}

async function recognizePrintedReceipt(inputBuffer) {
  const worker = await getWorker();

  // Deteksi warna kertas dulu — ini yang menentukan pipeline default.
  const color = await detectPaperColor(inputBuffer);
  console.log(
    `[POS-OCR] Paper color: R=${color.mean_r} G=${color.mean_g} B=${color.mean_b} colored=${color.is_colored} ch=${color.dominant_channel}`
  );

  let chosen = null;
  let pipelineUsed = "";
  let otsuValue = null;
  let metaWidth = 0;
  let metaHeight = 0;
  let upscaledTo = 0;

  if (color.is_colored) {
    // Kertas berwarna — pipeline colored channel sebagai utama
    const colored = await preprocessPrintedColored(inputBuffer, color.dominant_channel);
    const result = await tryPipelineMultiPsm(
      worker,
      colored.processed,
      `colored/${colored.channel}`
    );
    chosen = result;
    pipelineUsed = `sharp/printed/colored-${colored.channel}/psm${result.psm}`;
    otsuValue = colored.otsuValue;
    metaWidth = colored.width;
    metaHeight = colored.height;
    upscaledTo = colored.upscaled_to;
  } else {
    // Kertas putih — pipeline gentle dulu
    const gentle = await preprocessPrintedGentle(inputBuffer);
    const result = await tryPipelineMultiPsm(worker, gentle.processed, "gentle");
    chosen = result;
    pipelineUsed = `sharp/printed/gentle/psm${result.psm}`;
    metaWidth = gentle.width;
    metaHeight = gentle.height;
    upscaledTo = gentle.upscaled_to;
  }

  // Fallback: kalau pass utama tidak hasilkan cukup item, coba aggressive Otsu.
  if (chosen.valid <= 1) {
    console.log("[POS-OCR] Pass utama hasil minim → retry aggressive (Otsu global)");
    const aggressive = await preprocessPrintedAggressive(inputBuffer);
    const result = await tryPipelineMultiPsm(worker, aggressive.processed, "aggressive");
    if (result.valid > chosen.valid) {
      chosen = result;
      pipelineUsed = `sharp/printed/aggressive/psm${result.psm}`;
      otsuValue = aggressive.otsuValue;
    }
  }

  return {
    raw_text: chosen.data?.text || "",
    preprocessing: {
      pipeline: pipelineUsed,
      otsu_threshold: otsuValue,
      paper_color: color,
      width: metaWidth,
      height: metaHeight,
      upscaled_to: upscaledTo,
    },
    items: chosen.items,
  };
}

// =================================================================
// JALUR TULISAN TANGAN (opencv4nodejs)
// =================================================================

// Detect baris teks via horizontal projection profile pada binary mask.
// Return array of { yStart, yEnd } untuk setiap baris (band) terdeteksi.
function detectTextLines(binaryMat, cv) {
  // Sum piksel ink per baris
  const height = binaryMat.rows;
  const width = binaryMat.cols;
  const rowSums = new Array(height).fill(0);
  const data = binaryMat.getDataAsArray(); // 2D array
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) {
      // Setelah adaptiveThreshold + invert: tinta = 255, kertas = 0
      if (data[y][x] > 0) s++;
    }
    rowSums[y] = s;
  }
  // Ambang: 1.5% lebar gambar dianggap "ada teks di baris ini"
  const threshold = Math.max(3, Math.floor(width * 0.015));
  const lines = [];
  let inLine = false;
  let yStart = 0;
  for (let y = 0; y < height; y++) {
    if (rowSums[y] >= threshold) {
      if (!inLine) {
        inLine = true;
        yStart = y;
      }
    } else if (inLine) {
      inLine = false;
      const yEnd = y;
      // Filter band yang terlalu tipis (< 8 px ≈ noise) atau sangat tebal
      if (yEnd - yStart >= 8 && yEnd - yStart <= height * 0.5) {
        lines.push({ yStart, yEnd });
      }
    }
  }
  if (inLine) lines.push({ yStart, yEnd: height });
  return lines;
}

// Hitung skew angle untuk satu line region via minAreaRect dari kontur.
// Range: -15..+15 deg, fallback 0 jika tidak ada kontur signifikan.
function estimateLineSkew(lineMat, cv) {
  // Find contours pada binary line region
  const contours = lineMat.findContours(
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE
  );
  if (!contours || contours.length === 0) return 0;
  // Ambil contour terbesar (asumsikan merepresentasikan blok teks)
  let largest = contours[0];
  for (const c of contours) {
    if (c.area > largest.area) largest = c;
  }
  if (largest.area < 50) return 0;
  const rect = largest.minAreaRect();
  let angle = rect.angle;
  // OpenCV minAreaRect angle convention: -90..0
  if (angle < -45) angle += 90;
  // Clamp ekstrim
  if (angle < -15) angle = -15;
  if (angle > 15) angle = 15;
  return angle;
}

// Rotate satu line region by `angle` derajat lalu paste-back ke canvas baru.
function deskewPerLineMat(binaryMat, cv) {
  const lines = detectTextLines(binaryMat, cv);
  if (lines.length === 0) return binaryMat;

  const height = binaryMat.rows;
  const width = binaryMat.cols;
  // Canvas hitam (background = 0 setelah pipeline kita = kertas)
  const out = new cv.Mat(height, width, cv.CV_8UC1, [0]);

  for (const ln of lines) {
    // Tambah padding atas/bawah supaya rotasi tidak crop teks
    const pad = Math.min(8, ln.yStart, height - ln.yEnd);
    const y0 = ln.yStart - pad;
    const y1 = ln.yEnd + pad;
    const region = binaryMat.getRegion(new cv.Rect(0, y0, width, y1 - y0));
    const angle = estimateLineSkew(region.copy(), cv);
    let rotated;
    if (Math.abs(angle) < 0.5) {
      rotated = region.copy();
    } else {
      const center = new cv.Point2(width / 2, (y1 - y0) / 2);
      const M = cv.getRotationMatrix2D(center, angle, 1.0);
      rotated = region.warpAffine(
        M,
        new cv.Size(width, y1 - y0),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Vec(0, 0, 0)
      );
    }
    // Paste-back via copyTo
    rotated.copyTo(out.getRegion(new cv.Rect(0, y0, width, y1 - y0)));
  }
  return out;
}

// Pipeline preprocessing utama untuk tulisan tangan.
async function preprocessHandwritten(inputBuffer) {
  const cv = getCv(); // throw OCV_NOT_AVAILABLE jika modul tidak ada

  // Pre-rotate via sharp untuk hormati EXIF orientation (foto kamera HP),
  // re-encode jadi PNG buffer baru → opencv decode.
  const orientedBuffer = await sharp(inputBuffer).rotate().toBuffer();

  // Decode buffer → Mat. opencv4nodejs.imdecode menerima Buffer.
  let src = cv.imdecode(orientedBuffer);
  if (!src || src.empty) {
    throw new Error("Gagal decode gambar dengan opencv4nodejs");
  }

  // (1) Grayscale
  const gray =
    src.channels === 1 ? src : src.cvtColor(cv.COLOR_BGR2GRAY);

  // (2) Adaptive threshold (Gaussian, blockSize=11, C=2). Hasil: tinta=255, kertas=0.
  // Pakai THRESH_BINARY_INV agar tinta jadi foreground (untuk dilatasi & contour).
  const adaptive = gray.adaptiveThreshold(
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    11,
    2
  );

  // (3) Bilateral filter — perlu input grayscale 1ch (bukan binary), supaya
  // edge-preserving smoothing efektif. Kita filter `gray`, hasilnya kita
  // re-threshold via adaptive lagi. (Pendekatan: smooth dulu, threshold di akhir
  // untuk hasil lebih bersih daripada filter di binary.)
  const smoothed = gray.bilateralFilter(9, 75, 75);
  const adaptive2 = smoothed.adaptiveThreshold(
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    11,
    2
  );

  // (4) Deskew per-baris
  const deskewed = deskewPerLineMat(adaptive2, cv);

  // (5) Dilatasi morfologis ringan, kernel 2x2, 1 iterasi
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  const dilated = deskewed.dilate(kernel, new cv.Point2(-1, -1), 1);

  // Tesseract butuh tinta gelap di latar terang → invert kembali.
  const finalBin = dilated.bitwiseNot();

  // Encode ke PNG buffer untuk diteruskan ke worker.
  const pngBuffer = cv.imencode(".png", finalBin);

  return {
    processed: pngBuffer,
    width: src.cols,
    height: src.rows,
    n_lines_detected: detectTextLines(adaptive2, cv).length,
  };
}

// ---------- 6b. Entry point TULISAN TANGAN ----------
async function recognizeHandwrittenReceipt(inputBuffer) {
  const { processed, width, height, n_lines_detected } =
    await preprocessHandwritten(inputBuffer);

  const worker = await getWorker();
  // Reset PSM ke 6 — pipeline printed multi-PSM bisa meninggalkan PSM=4
  // di worker shared. Tulisan tangan paling cocok dengan PSM 6 (single block).
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
  });
  const { data } = await worker.recognize(processed);
  const rawText = data.text || "";

  let items = parseTesseractData(data);
  items = flagLowConfidence(items, 45); // Strategi 3: ambang tulisan tangan

  return {
    raw_text: rawText,
    preprocessing: {
      pipeline: "opencv/handwritten",
      width,
      height,
      n_lines_detected,
    },
    items,
  };
}

module.exports = {
  recognizePrintedReceipt,
  recognizeHandwrittenReceipt,
  preprocessPrinted,
  preprocessHandwritten,
  computeOtsuThreshold,
  parseTesseractData,
  flagLowConfidence,
  terminateWorker,
};
