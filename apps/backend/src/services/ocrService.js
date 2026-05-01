// =================================================================
// ocrService.js — Pipeline OCR untuk nota CETAK KOMPUTER
// =================================================================
// Strategi 2 (Pipeline Preprocessing Bersyarat) — JALUR CETAK:
//   1. Grayscale
//   2. Otsu thresholding (manual, sharp tidak punya bawaan — kita
//      hitung histogram lalu feed nilai threshold optimal ke sharp)
//   3. Median blur kernel 3 (noise removal)
//   (Hough deskewing dilewati untuk Pertemuan 8: nota cetak biasanya
//    sudah tegak dari scanner/foto frontal. Akan ditangani di pertemuan
//    berikutnya bersama jalur tulisan tangan via opencv4nodejs.)
//
// Setelah preprocessing → tesseract.js dengan trained data 'ind+eng'.
// Hasil di-parse via regex untuk field: kode_barang, nama_barang, qty,
// harga_beli, diskon_persen. Confidence per field = rata-rata confidence
// kata-kata yang menyusun field tersebut.
// =================================================================

const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

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

// ---------- 6. Entry point untuk service layer ----------
async function recognizePrintedReceipt(inputBuffer) {
  const { processed, otsuValue, width, height } = await preprocessPrinted(inputBuffer);

  const worker = await getWorker();
  const { data } = await worker.recognize(processed);
  const rawText = data.text || "";

  let items = parseTesseractData(data);
  items = flagLowConfidence(items, 60); // Strategi 3: ambang cetak

  return {
    raw_text: rawText,
    preprocessing: { otsu_threshold: otsuValue, width, height },
    items,
  };
}

module.exports = {
  recognizePrintedReceipt,
  preprocessPrinted,
  computeOtsuThreshold,
  parseTesseractData,
  flagLowConfidence,
  terminateWorker,
};
