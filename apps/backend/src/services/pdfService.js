// =================================================================
// pdfService.js — Ekstraksi text-layer dari nota format PDF
// =================================================================
// Strategi: PDF dari supplier biasanya 2 jenis —
//   (A) PDF "lahir digital" (di-export dari Excel/Word/sistem POS) — punya
//       text-layer yang bisa diekstrak langsung. Akurasi praktis ~100%
//       karena bukan OCR, melainkan baca teks asli yang di-encode di file.
//   (B) PDF scan (foto/scanner kemudian di-PDF-kan) — text-layer kosong.
//       Untuk kasus ini, sistem fallback ke pipeline OCR gambar
//       (render halaman pertama jadi PNG, lalu masuk Tesseract).
//
// Halaman pertama biasanya cukup untuk nota toko motor (1-2 halaman).
// Multi-halaman bisa di-implement di iterasi berikutnya.
// =================================================================

const { PDFParse } = require("pdf-parse");

// Threshold: kalau hasil ekstrak text < 50 char alfanumerik, anggap
// PDF-nya scan-only (tidak punya text layer signifikan).
const MIN_TEXT_CHARS_FOR_DIGITAL = 50;

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result?.text || "";
    const pageCount = result?.numpages || result?.pages?.length || 0;
    const alphanumCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
    const isDigital = alphanumCount >= MIN_TEXT_CHARS_FOR_DIGITAL;
    return {
      text,
      pageCount,
      alphanumCount,
      isDigital,
    };
  } finally {
    if (typeof parser.destroy === "function") {
      try {
        await parser.destroy();
      } catch {
        /* ignore cleanup error */
      }
    }
  }
}

// Render halaman pertama PDF ke PNG buffer (untuk fallback kalau text-layer
// kosong → masuk pipeline OCR gambar yang sudah ada).
async function renderPdfFirstPagePng(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    if (typeof parser.getScreenshot !== "function") {
      throw new Error("PDF render tidak tersedia di environment ini");
    }
    const result = await parser.getScreenshot({ pages: [1], scale: 2 });
    const first = result?.pages?.[0] || result?.[0] || result;
    // pdf-parse v2 mengembalikan Buffer atau Uint8Array tergantung env
    const png = first?.png || first?.image || first;
    if (!png || !(png instanceof Uint8Array || Buffer.isBuffer(png))) {
      throw new Error("Tidak bisa parse output renderer PDF");
    }
    return Buffer.isBuffer(png) ? png : Buffer.from(png);
  } finally {
    if (typeof parser.destroy === "function") {
      try {
        await parser.destroy();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  extractPdfText,
  renderPdfFirstPagePng,
  MIN_TEXT_CHARS_FOR_DIGITAL,
};
