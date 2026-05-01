const express = require("express");
const multer = require("multer");
const router = express.Router();

const {
  processOcr,
  commitPurchase,
  listPurchases,
} = require("../controllers/purchasesController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Pertemuan 8: jalur nota CETAK saja → image (JPG/PNG/WebP).
// Jalur PDF + tulisan tangan menyusul di pertemuan berikutnya.
const PRINTED_MIME_RE = /^image\/(jpeg|jpg|png|webp)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (!PRINTED_MIME_RE.test(file.mimetype)) {
      return cb(
        new Error(
          "Format tidak didukung. Pertemuan 8 hanya menerima JPG/PNG/WebP (nota cetak)."
        )
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

module.exports = router;
