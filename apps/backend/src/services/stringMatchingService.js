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

// Threshold minimum untuk dianggap kandidat layak. Di bawah ini, produk
// tidak akan ditampilkan sebagai sugesti — UI akan menunjukkan slot kosong
// supaya user pilih manual dari katalog. Ini cegah sugesti random
// 5–25% yang menyesatkan saat katalog DB tidak punya produk yang dimaksud.
const MIN_SIMILARITY_FOR_SUGGESTION = 0.4;

// Cek substring exact (case-insensitive, ignore separator). Kalau OCR-kode
// "SVD-E1310-20" dan produk-kode "SVDE131020", kita anggap match karena
// dash sering hilang di OCR. Hanya berlaku kalau kedua string ≥ 5 char.
function isCodeExactMatch(ocrKode, prodKode) {
  if (!ocrKode || !prodKode) return false;
  const a = String(ocrKode).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = String(prodKode).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (a.length < 5 || b.length < 5) return false;
  if (a === b) return true;
  // Substring di salah satu arah (OCR kadang potong / tambah karakter)
  if (a.length >= 7 && b.includes(a)) return true;
  if (b.length >= 7 && a.includes(b)) return true;
  return false;
}

// Cari top-N kandidat produk untuk satu hasil OCR (nama + opsional kode).
// products: array { id, kode_barang, nama_barang, ... } dari catalog aktif.
// Strategi prioritas:
//   1. Kalau ocrKode exact match (substring/identik) dengan kode produk → score 1.0.
//   2. Kalau tidak, weighted: nama 70% + kode 30% (Levenshtein).
//   3. Drop kandidat dengan score < MIN_SIMILARITY_FOR_SUGGESTION.
function findTopCandidates({ ocrName, ocrKode, products, topN = 3 }) {
  if (!products || products.length === 0) return [];

  const ranked = products.map((p) => {
    const exactKode = isCodeExactMatch(ocrKode, p.kode_barang);
    const simNama = similarity(ocrName, p.nama_barang);
    const simKode = ocrKode ? similarity(ocrKode, p.kode_barang) : 0;

    let score;
    if (exactKode) {
      score = 1.0; // exact-match pemenang mutlak
    } else if (ocrKode) {
      score = simNama * 0.7 + simKode * 0.3;
    } else {
      score = simNama;
    }

    return {
      product_id: p.id,
      kode_barang: p.kode_barang,
      nama_barang: p.nama_barang,
      merk: p.merk,
      harga_beli_terakhir: p.harga_beli ? Number(p.harga_beli) : null,
      similarity: Math.round(score * 1000) / 1000,
      similarity_nama: Math.round(simNama * 1000) / 1000,
      similarity_kode: Math.round(simKode * 1000) / 1000,
      exact_kode_match: exactKode,
    };
  });

  ranked.sort((a, b) => b.similarity - a.similarity);
  // Filter: hanya tampilkan kandidat di atas threshold. Kalau tidak ada
  // sama sekali yang lolos, balas array kosong → UI minta user pilih manual.
  const filtered = ranked.filter((c) => c.similarity >= MIN_SIMILARITY_FOR_SUGGESTION);
  return filtered.slice(0, topN);
}

module.exports = {
  findTopCandidates,
  similarity,
  normalize,
  isCodeExactMatch,
  MIN_SIMILARITY_FOR_SUGGESTION,
};
