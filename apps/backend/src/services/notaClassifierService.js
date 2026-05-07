// =================================================================
// notaClassifierService.js — STRATEGI 1: Klasifikasi Awal Jenis Nota
// =================================================================
// Subbab 3.2.6.4 (Mitigasi OCR Tulisan Tangan), Strategi 1.
//
// Tujuan: dari satu image buffer, putuskan jalur preprocessing mana
// yang cocok — pipeline 'cetak' (sharp) atau 'tulisan_tangan'
// (opencv4nodejs). Kalau tidak yakin → 'ambigu' supaya frontend bisa
// tampilkan radio-button konfirmasi manual ke user.
//
// Pipeline klasifikasi (cepat, tanpa OCR):
//   (a) Resize cap → 800px lebar (biar konsisten + cepat)
//   (b) Grayscale + Otsu binary threshold (1 = tinta, 0 = kertas)
//   (c) Hitung 3 fitur:
//         - histogram_concentration  (konsentrasi distribusi piksel)
//         - stroke_width_variance    (variasi lebar coretan)
//         - avg_tilt_deg             (rata-rata kemiringan baris teks)
//   (d) Heuristik IF-THEN → cetak / tulisan_tangan / ambigu
// =================================================================

const sharp = require("sharp");
const { computeOtsuThreshold } = require("./ocrService");

// ---- Ambang heuristik (di-tune empiris untuk skripsi) -------------
// Nota cetak: lebar-garis seragam (CV stroke rendah) + baris tegak.
// Tulisan tangan: variasi tinggi + kemiringan baris signifikan.
const STROKE_CV_PRINTED_MAX = 0.45; // CV stroke <= 0.45 → cenderung cetak
const STROKE_CV_HANDWRITING_MIN = 0.65; // CV stroke >= 0.65 → cenderung tulisan tangan
const TILT_PRINTED_MAX_DEG = 5; // tilt <=5° → tegak (cetak)
const TILT_HANDWRITING_MIN_DEG = 10; // tilt >=10° → miring (tulisan tangan)

// ---- (a) Standardisasi ukuran ----
async function normalizeForClassification(inputBuffer) {
  // Convert ke grayscale, resize ke max 800px lebar, raw buffer 1 channel.
  // .rotate() = auto-orient EXIF (foto langsung dari kamera HP).
  const meta = await sharp(inputBuffer).rotate().metadata();
  const targetWidth = Math.min(800, meta.width || 800);
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .greyscale()
    .resize({ width: targetWidth, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { gray: data, width: info.width, height: info.height };
}

// ---- (b) Binary mask via Otsu (1 = ink/foreground, 0 = paper) ----
function binarizeOtsu(gray) {
  const t = computeOtsuThreshold(gray);
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    // Pixel < threshold dianggap tinta (gelap) → 1
    bin[i] = gray[i] < t ? 1 : 0;
  }
  return { bin, threshold: t };
}

// ---- (c1) Histogram concentration -----------------------------------
// Hitung dispersi distribusi intensitas. Nota cetak biasanya bimodal
// tajam (tinta hitam pekat + kertas putih bersih) → konsentrasi tinggi.
// Tulisan tangan + foto HP cenderung lebih tersebar → konsentrasi rendah.
function histogramConcentration(gray) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
  // Cari 2 puncak terbesar; ukur fraksi piksel di sekitarnya (±10).
  const total = gray.length;
  let top1 = 0;
  let top1Idx = 0;
  let top2 = 0;
  let top2Idx = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > top1) {
      top2 = top1;
      top2Idx = top1Idx;
      top1 = histogram[i];
      top1Idx = i;
    } else if (histogram[i] > top2) {
      top2 = histogram[i];
      top2Idx = i;
    }
  }
  let near = 0;
  for (let i = 0; i < 256; i++) {
    if (
      Math.abs(i - top1Idx) <= 10 ||
      Math.abs(i - top2Idx) <= 10
    ) {
      near += histogram[i];
    }
  }
  return near / total; // 0..1, makin tinggi = makin bimodal/cetak
}

// ---- (c2) Stroke width variance ------------------------------------
// Untuk setiap baris piksel, hitung panjang segmen-tinta (run-length).
// CV (stdev / mean) dari panjang ini = proxy variasi lebar coretan.
function strokeWidthVariance(bin, width, height) {
  const lengths = [];
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      if (bin[y * width + x] === 1) {
        run++;
      } else if (run > 0) {
        // Filter run yang terlalu panjang (mungkin garis horizontal kop nota)
        if (run >= 1 && run <= 30) lengths.push(run);
        run = 0;
      }
    }
    if (run > 0 && run <= 30) lengths.push(run);
  }
  if (lengths.length < 30) {
    return { mean: 0, stdev: 0, cv: 0, samples: lengths.length };
  }
  const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
  const varSum = lengths.reduce(
    (s, v) => s + (v - mean) * (v - mean),
    0
  );
  const stdev = Math.sqrt(varSum / lengths.length);
  const cv = mean > 0 ? stdev / mean : 0;
  return { mean, stdev, cv, samples: lengths.length };
}

// ---- (c3) Average tilt angle (deg) ---------------------------------
// Heuristik proyeksi profile + rotasi: cari sudut [-15°..+15°] yang
// memaksimalkan variansi proyeksi horizontal (baris paling 'tegas').
// Selisih sudut maksimum dari 0 = tilt rata-rata.
function projectionVariance(bin, width, height, angleDeg) {
  // Rotasi sederhana via shear (cukup untuk ukuran sudut kecil & cepat).
  // shift x = -y * tan(angle), lalu hitung jumlah piksel ink per baris.
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  const proj = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (bin[y * width + x] === 1) {
        // Shear-rotate ke baris hasil
        const yPrime = Math.floor(y + x * tan);
        if (yPrime >= 0 && yPrime < height) {
          // Cara lebih akurat butuh full reproject, tapi untuk metric
          // variansi proyeksi cukup pakai count per yPrime.
          proj[yPrime] = (proj[yPrime] || 0) + 1;
        }
        count++;
      }
    }
  }
  const mean = proj.reduce((s, v) => s + v, 0) / proj.length;
  const variance =
    proj.reduce((s, v) => s + (v - mean) * (v - mean), 0) / proj.length;
  return variance;
}

function estimateTiltDeg(bin, width, height) {
  let bestAngle = 0;
  let bestVar = -Infinity;
  // Sweep -15..+15 deg, step 1 derajat — cukup untuk klasifikasi.
  for (let a = -15; a <= 15; a++) {
    const v = projectionVariance(bin, width, height, a);
    if (v > bestVar) {
      bestVar = v;
      bestAngle = a;
    }
  }
  return Math.abs(bestAngle);
}

// ---- (d) Heuristik final --------------------------------------------
function decideType({ stroke_cv, avg_tilt_deg, hist_concentration }) {
  // Skor cetak: stroke seragam + tegak + histogram bimodal kuat
  let printedScore = 0;
  let handwrittenScore = 0;

  if (stroke_cv <= STROKE_CV_PRINTED_MAX) printedScore++;
  if (stroke_cv >= STROKE_CV_HANDWRITING_MIN) handwrittenScore++;

  if (avg_tilt_deg <= TILT_PRINTED_MAX_DEG) printedScore++;
  if (avg_tilt_deg >= TILT_HANDWRITING_MIN_DEG) handwrittenScore++;

  if (hist_concentration >= 0.55) printedScore++;
  if (hist_concentration <= 0.35) handwrittenScore++;

  if (printedScore >= 2 && handwrittenScore === 0) return "cetak";
  if (handwrittenScore >= 2 && printedScore === 0) return "tulisan_tangan";
  return "ambigu";
}

// ---- Public API ----
async function classifyNota(inputBuffer) {
  const { gray, width, height } = await normalizeForClassification(inputBuffer);
  const { bin, threshold } = binarizeOtsu(gray);
  const concentration = histogramConcentration(gray);
  const stroke = strokeWidthVariance(bin, width, height);
  const tilt = estimateTiltDeg(bin, width, height);

  const type = decideType({
    stroke_cv: stroke.cv,
    avg_tilt_deg: tilt,
    hist_concentration: concentration,
  });

  const features = {
    width,
    height,
    otsu_threshold: threshold,
    histogram_concentration: Number(concentration.toFixed(3)),
    stroke_width: {
      mean: Number(stroke.mean.toFixed(2)),
      stdev: Number(stroke.stdev.toFixed(2)),
      cv: Number(stroke.cv.toFixed(3)),
      samples: stroke.samples,
    },
    avg_tilt_deg: tilt,
  };

  console.log(
    `[POS-OCR-CLASSIFIER] type=${type} stroke_cv=${features.stroke_width.cv} tilt=${tilt}° hist=${features.histogram_concentration}`
  );

  return { type, features };
}

module.exports = {
  classifyNota,
  // Expose juga sub-fungsi untuk testing & debugging laporan
  binarizeOtsu,
  histogramConcentration,
  strokeWidthVariance,
  estimateTiltDeg,
  decideType,
};
