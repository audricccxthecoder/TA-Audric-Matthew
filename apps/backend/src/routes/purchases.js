const express = require("express");
const multer = require("multer");
const router = express.Router();

const {
  processOcr,
  commitPurchase,
  listPurchases,
  saveDraft,
  listDrafts,
  getDraft,
  deleteDraft,
} = require("../controllers/purchasesController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Pertemuan 9: terima JPG/PNG/WebP. Klasifikasi cetak vs tulisan tangan
// dilakukan di service layer (Strategi 1). PDF belum didukung — perlu
// pdf-to-image converter terpisah, di luar scope laporan saat ini.
const ACCEPTED_MIME_RE = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (!ACCEPTED_MIME_RE.test(file.mimetype)) {
      return cb(
        new Error("Format tidak didukung. Gunakan JPG / PNG / WebP / PDF.")
      );
    }
    cb(null, true);
  },
});

// Lapisan 2: kasir & admin boleh input stok masuk
router.use(authMiddleware, roleMiddleware("kasir", "admin"));

// Wrapping multer agar error (file size / mimetype) jadi HTTP 400 yang rapi
function uploadSingleNota(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "File terlalu besar (maks 10 MB)"
          : err.message;
      return res.status(400).json({ error: message });
    }
    next();
  });
}

router.post("/ocr", uploadSingleNota, processOcr);
router.post("/commit", commitPurchase);
router.get("/", listPurchases);

// Drafts: scan di HP → resume di laptop (atau sebaliknya).
// Dipakai endpoints: POST /api/purchases/drafts (save), GET (list),
// GET /:id (load one), DELETE /:id (cancel).
router.get("/drafts", listDrafts);
router.post("/drafts", express.json({ limit: "5mb" }), saveDraft);
router.get("/drafts/:id", getDraft);
router.delete("/drafts/:id", deleteDraft);

module.exports = router;
