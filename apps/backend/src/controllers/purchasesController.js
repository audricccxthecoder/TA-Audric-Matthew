const purchasesService = require("../services/purchasesService");

// POST /api/purchases/ocr (multipart/form-data, field "file")
async function processOcr(req, res) {
  try {
    const result = await purchasesService.processOcr({
      user: req.user,
      file: req.file,
      noNotaSupplier: req.body?.no_nota_supplier,
    });
    return res.status(200).json({
      message: "OCR berhasil — silakan validasi hasil sebelum simpan",
      data: result,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[POS-PURCHASES] processOcr error:", err.message);
    } else {
      console.warn(`[POS-PURCHASES] processOcr ${status}: ${err.message}`);
    }
    return res.status(status).json({ error: err.message });
  }
}

// POST /api/purchases/commit
async function commitPurchase(req, res) {
  try {
    const detail = await purchasesService.commitPurchase({
      user: req.user,
      payload: req.body,
    });
    return res.status(201).json({
      message: "Stok masuk berhasil disimpan",
      data: detail,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[POS-PURCHASES] commitPurchase error:", err.message);
    } else {
      console.warn(
        `[POS-PURCHASES] commitPurchase ${err.rule || ""} ${status}: ${err.message}`
      );
    }
    return res.status(status).json({
      error: err.message,
      rule: err.rule || null,
    });
  }
}

// GET /api/purchases?from=&to=&limit=
async function listPurchases(req, res) {
  try {
    const { from, to, limit } = req.query;
    const data = await purchasesService.listPurchases({
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return res.json({ data });
  } catch (err) {
    console.error("[POS-PURCHASES] listPurchases error:", err.message);
    return res.status(500).json({ error: "Gagal memuat daftar pembelian" });
  }
}

module.exports = { processOcr, commitPurchase, listPurchases };
