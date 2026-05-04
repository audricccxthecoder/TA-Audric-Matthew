const productRepository = require("../repositories/productRepository");
const stockLogRepository = require("../repositories/stockLogRepository");

const FORBIDDEN_PATCH_FIELDS = ["id", "stok", "created_at", "updated_at"];
const ADMIN_ONLY_FIELDS = ["min_stock"];

function validateProductPayload(payload, { isUpdate = false } = {}) {
  const errors = [];

  if (!isUpdate) {
    if (!payload.kode_barang || typeof payload.kode_barang !== "string") {
      errors.push("kode_barang wajib diisi");
    }
    if (!payload.nama_barang || typeof payload.nama_barang !== "string") {
      errors.push("nama_barang wajib diisi");
    }
  }

  if (payload.kode_barang != null && payload.kode_barang.length > 30) {
    errors.push("kode_barang maksimal 30 karakter");
  }
  if (payload.nama_barang != null && payload.nama_barang.length > 150) {
    errors.push("nama_barang maksimal 150 karakter");
  }
  if (payload.merk != null && typeof payload.merk === "string" && payload.merk.length > 80) {
    errors.push("merk maksimal 80 karakter");
  }
  for (const numField of ["harga_beli", "harga_jual"]) {
    if (
      payload[numField] != null &&
      (typeof payload[numField] !== "number" || payload[numField] < 0)
    ) {
      errors.push(`${numField} harus angka >= 0`);
    }
  }
  if (
    payload.min_stock != null &&
    (!Number.isInteger(payload.min_stock) || payload.min_stock < 0)
  ) {
    errors.push("min_stock harus bilangan bulat >= 0");
  }
  if (payload.status != null && !["aktif", "nonaktif"].includes(payload.status)) {
    errors.push("status harus 'aktif' atau 'nonaktif'");
  }

  return errors;
}

// GET /api/products?q=&limit=&status=&stock=
async function searchProducts(req, res) {
  try {
    const { q = "", limit, status, stock } = req.query;
    const data = await productRepository.search({
      q,
      status: status === "aktif" || status === "nonaktif" ? status : status === "all" ? null : "aktif",
      stockFilter: ["low", "out", "normal"].includes(stock) ? stock : null,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 20,
    });
    return res.json({ data });
  } catch (err) {
    console.error("[POS-PROD] searchProducts error:", err.message);
    return res.status(500).json({ error: "Gagal mencari produk" });
  }
}

// GET /api/products/:id
async function getProduct(req, res) {
  try {
    const product = await productRepository.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });
    return res.json({ data: product });
  } catch (err) {
    console.error("[POS-PROD] getProduct error:", err.message);
    return res.status(500).json({ error: "Gagal memuat produk" });
  }
}

// POST /api/products
async function createProduct(req, res) {
  try {
    const payload = req.body || {};
    const errors = validateProductPayload(payload, { isUpdate: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    // min_stock hanya boleh di-set saat create oleh role admin
    if (payload.min_stock != null && req.user.role !== "admin") {
      return res.status(403).json({
        error: "Hanya admin yang boleh mengatur min_stock",
      });
    }

    if (await productRepository.existsByKodeBarang(payload.kode_barang)) {
      return res.status(409).json({ error: "Kode barang sudah dipakai" });
    }

    const created = await productRepository.create({
      kode_barang: payload.kode_barang.trim(),
      nama_barang: payload.nama_barang.trim(),
      merk: payload.merk?.trim() || null,
      harga_beli: Number(payload.harga_beli) || 0,
      harga_jual: Number(payload.harga_jual) || 0,
      min_stock: Number.isInteger(payload.min_stock) ? payload.min_stock : 0,
      status: payload.status || "aktif",
    });

    console.log(
      `[POS-PROD] Produk baru ${created.kode_barang} dibuat oleh ${req.user.username}`
    );
    return res.status(201).json({
      message: "Produk berhasil dibuat",
      data: created,
    });
  } catch (err) {
    console.error("[POS-PROD] createProduct error:", err.message);
    return res.status(500).json({ error: err.message || "Gagal membuat produk" });
  }
}

// PATCH /api/products/:id
async function updateProduct(req, res) {
  try {
    const id = req.params.id;
    const payload = req.body || {};

    // Tolak field terlarang (stok dijaga R3 — tidak boleh diubah manual)
    for (const f of FORBIDDEN_PATCH_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, f)) {
        return res.status(400).json({
          error: `Field '${f}' tidak boleh diubah lewat endpoint ini${
            f === "stok" ? " (R3: stok hanya berubah via penjualan / stok masuk)" : ""
          }`,
        });
      }
    }

    // RBAC field-level: min_stock hanya admin
    for (const f of ADMIN_ONLY_FIELDS) {
      if (
        Object.prototype.hasOwnProperty.call(payload, f) &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({
          error: `Hanya admin yang boleh mengubah ${f}`,
        });
      }
    }

    const errors = validateProductPayload(payload, { isUpdate: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    const existing = await productRepository.findById(id);
    if (!existing) return res.status(404).json({ error: "Produk tidak ditemukan" });

    if (
      payload.kode_barang &&
      payload.kode_barang !== existing.kode_barang &&
      (await productRepository.existsByKodeBarang(payload.kode_barang, id))
    ) {
      return res.status(409).json({ error: "Kode barang sudah dipakai" });
    }

    const patch = {};
    for (const f of [
      "kode_barang",
      "nama_barang",
      "merk",
      "harga_beli",
      "harga_jual",
      "min_stock",
      "status",
    ]) {
      if (Object.prototype.hasOwnProperty.call(payload, f)) {
        patch[f] = typeof payload[f] === "string" ? payload[f].trim() : payload[f];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Tidak ada field yang diubah" });
    }

    const updated = await productRepository.update(id, patch);

    // Audit perubahan harga / status / min_stock (bukan stock_logs entry stok,
    // tapi sebagai jejak perubahan master data — pakai source_type='manual' R5 agar tidak ambigu)
    await stockLogRepository.write({
      product_id: id,
      user_id: req.user.id,
      delta_qty: 0,
      stok_sebelum: existing.stok,
      stok_sesudah: existing.stok,
      source_type: "manual",
      rule_triggered: null,
      rule_action: "ACCEPTED",
      reason_detail: `Master data produk diubah: ${Object.keys(patch).join(", ")}`,
      context_payload: {
        before: existing,
        after: updated,
        changed_by: req.user.username,
      },
    });

    console.log(
      `[POS-PROD] Produk ${updated.kode_barang} diupdate oleh ${req.user.username}`
    );
    return res.json({
      message: "Produk berhasil diupdate",
      data: updated,
    });
  } catch (err) {
    console.error("[POS-PROD] updateProduct error:", err.message);
    if (err.rule === "R3") {
      return res.status(409).json({ error: err.message, rule: "R3" });
    }
    return res.status(500).json({ error: err.message || "Gagal mengupdate produk" });
  }
}

module.exports = {
  searchProducts,
  getProduct,
  createProduct,
  updateProduct,
};
