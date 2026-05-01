// =================================================================
// stringMatchingService.js — Levenshtein top-3 candidate matcher
// =================================================================
// Dipakai modul OCR untuk memberi rekomendasi product_id kepada hasil
// ekstraksi nama_barang yang biasanya kotor (typo, spasi hilang, dll).
// Formula similarity: 1 - distance / max(len_a, len_b).
// =================================================================

const levenshtein = require("fast-levenshtein");

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const distance = levenshtein.get(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - distance / maxLen;
}

// Cari top-N kandidat produk untuk satu hasil OCR (nama + opsional kode).
// products: array { id, kode_barang, nama_barang, ... } dari catalog aktif.
// Bobot: nama_barang 70%, kode_barang 30% (kalau OCR juga menangkap kode).
function findTopCandidates({ ocrName, ocrKode, products, topN = 3 }) {
  if (!products || products.length === 0) return [];

  const ranked = products.map((p) => {
    const simNama = similarity(ocrName, p.nama_barang);
    const simKode = ocrKode ? similarity(ocrKode, p.kode_barang) : 0;
    const score = ocrKode ? simNama * 0.7 + simKode * 0.3 : simNama;

    return {
      product_id: p.id,
      kode_barang: p.kode_barang,
      nama_barang: p.nama_barang,
      merk: p.merk,
      harga_beli_terakhir: p.harga_beli ? Number(p.harga_beli) : null,
      similarity: Math.round(score * 1000) / 1000,
      similarity_nama: Math.round(simNama * 1000) / 1000,
      similarity_kode: Math.round(simKode * 1000) / 1000,
    };
  });

  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, topN);
}

module.exports = { findTopCandidates, similarity, normalize };
