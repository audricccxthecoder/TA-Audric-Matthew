// =================================================================
// ocrService.js — Pipeline OCR (jalur CETAK + jalur TULISAN TANGAN)
// =================================================================
// Strategi 2 (Pipeline Preprocessing Bersyarat) — sub-bab 3.2.6.4:
//
//   JALUR CETAK (sharp):
//     1. Grayscale
//     2. Otsu thresholding (sharp tidak punya bawaan — kita hitung
//        histogram lalu feed nilai threshold optimal ke sharp)
//     3. Median blur kernel 3 (noise removal)
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

// ---------- 2. Pipeline preprocessing untuk nota CETAK ----------
async function preprocessPrinted(inputBuffer) {
  // (a) Grayscale
  const grey = sharp(inputBuffer).greyscale();

  // (b) Otsu thresholding — butuh raw buffer untuk hitung histogram
  const { data: rawGrey, info } = await grey
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const otsuValue = computeOtsuThreshold(rawGrey);
  console.log(
    `[POS-OCR] Otsu threshold = ${otsuValue} (image ${info.width}x${info.height})`
  );

  // (c) Apply: threshold + median blur kernel 3 + normalize untuk kontras
  const processed = await sharp(inputBuffer)
    .greyscale()
    .normalize()
    .median(3)
    .threshold(otsuValue)
    .toBuffer();

  return { processed, otsuValue, width: info.width, height: info.height };
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

const SKIP_LINE_RE =
  /^(total|sub\s?total|grand\s?total|invoice|nota|tanggal|tgl|tanda terima|hormat|tunai|kembalian|ppn|pajak|diskon\s+total)/i;

function parseAmount(str) {
  // "Rp 25.000" / "1,234,567" / "1.234,50" → number
  // Heuristik sederhana: hapus semua non-digit kecuali separator terakhir.
  const cleaned = String(str).replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  // Asumsikan separator ribuan ('.' atau ','). Hapus semuanya untuk ambil integer rupiah.
  return parseFloat(cleaned.replace(/[.,]/g, "")) || 0;
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

function parseLineToItem(line) {
  const text = (line.text || "").trim();
  if (text.length < 6) return null;
  if (SKIP_LINE_RE.test(text)) return null;

  const words = line.words || [];

  // Field qty: angka diikuti satuan (pcs/pc/unit) ATAU didahului keyword qty/jml/jumlah/x
  const qtyMatch =
    text.match(/(?:qty|jml|jumlah|jum)\s*[:.]?\s*(\d{1,4})/i) ||
    text.match(/\b(\d{1,4})\s*(?:pcs|pc|unit|btl|pak|set)\b/i) ||
    text.match(/\b(\d{1,4})\s*x\s/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : null;

  // Field harga_beli: setelah Rp/IDR ATAU angka besar dengan separator ribuan
  const hargaMatch =
    text.match(/(?:rp\.?|idr)\s*([\d.,]+)/i) ||
    text.match(/\b(\d{1,3}(?:[.,]\d{3}){1,3})\b/);
  const harga_beli = hargaMatch ? parseAmount(hargaMatch[1]) : null;

  // Field diskon_persen: angka diikuti %
  const diskMatch = text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  const diskon_persen = diskMatch
    ? parseFloat(String(diskMatch[1]).replace(",", ".")) || 0
    : 0;

  // Field kode_barang: token alfanumerik 4+ karakter (boleh berisi '-')
  // Hindari menangkap "Rp", angka rupiah, dll.
  const kodeMatch = text.match(/\b([A-Z][A-Z0-9]{2,}[-]?[A-Z0-9]{1,})\b/);
  const kode_barang = kodeMatch ? kodeMatch[0] : "";

  // Sisa untuk nama_barang: hilangkan field-field yang sudah ditangkap
  let leftover = text;
  const eaten = [];
  if (qtyMatch) {
    leftover = leftover.replace(qtyMatch[0], " ");
    eaten.push(qtyMatch[0]);
  }
  if (hargaMatch) {
    leftover = leftover.replace(hargaMatch[0], " ");
    eaten.push(hargaMatch[0]);
  }
  if (diskMatch) {
    leftover = leftover.replace(diskMatch[0], " ");
    eaten.push(diskMatch[0]);
  }
  if (kodeMatch) {
    leftover = leftover.replace(kodeMatch[0], " ");
    eaten.push(kodeMatch[0]);
  }
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
  const lines = data?.lines || [];
  const items = [];
  for (const line of lines) {
    const item = parseLineToItem(line);
    if (item) items.push(item);
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

// ---------- 6a. Entry point CETAK ----------
async function recognizePrintedReceipt(inputBuffer) {
  const { processed, otsuValue, width, height } = await preprocessPrinted(inputBuffer);

  const worker = await getWorker();
  const { data } = await worker.recognize(processed);
  const rawText = data.text || "";

  let items = parseTesseractData(data);
  items = flagLowConfidence(items, 60); // Strategi 3: ambang cetak

  return {
    raw_text: rawText,
    preprocessing: {
      pipeline: "sharp/printed",
      otsu_threshold: otsuValue,
      width,
      height,
    },
    items,
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

  // Decode buffer → Mat. opencv4nodejs.imdecode menerima Buffer.
  let src = cv.imdecode(inputBuffer);
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
